from __future__ import annotations

import argparse
import csv
import json
import os
import shlex
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval.lib.http_client import WebsiteChatClient


@dataclass
class AcceptanceCase:
    id: str
    question: str
    expected_accepted: bool
    raw_expected_accepted: bool | None
    label: str | None
    notes: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run expected_acceptance checks against website chat API."
    )
    parser.add_argument("--input", type=Path, required=True, help="Path to acceptance JSON file.")
    parser.add_argument(
        "--base-url",
        type=str,
        default=None,
        help="Website base URL (fallback env OPENAIP_WEBSITE_BASE_URL).",
    )
    parser.add_argument(
        "--token",
        type=str,
        default=None,
        help="Bearer token (fallback env OPENAIP_EVAL_BEARER_TOKEN).",
    )
    parser.add_argument(
        "--cookie-header",
        type=str,
        default=None,
        help="Cookie header (fallback env OPENAIP_EVAL_COOKIE_HEADER).",
    )
    parser.add_argument(
        "--origin",
        type=str,
        default=None,
        help="Origin header (fallback env OPENAIP_EVAL_ORIGIN, then base URL).",
    )
    parser.add_argument(
        "--referer",
        type=str,
        default=None,
        help="Referer header (fallback env OPENAIP_EVAL_REFERER, then <base-url>/barangay/chatbot).",
    )
    parser.add_argument("--max", type=int, default=None, help="Max number of rows to run.")
    parser.add_argument(
        "--out-root",
        type=Path,
        default=Path("eval/results"),
        help="Directory where run outputs will be written.",
    )
    parser.add_argument(
        "--stateful",
        action="store_true",
        help="Reuse one session ID across all questions (default is stateless per question).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate input only.")
    return parser.parse_args()


def _resolve_path(path_arg: Path) -> Path:
    path = path_arg
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _build_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-acceptance")


def _read_cases(path: Path) -> list[AcceptanceCase]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Input file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {path}: {exc}") from exc

    items = payload.get("items")
    if not isinstance(items, list):
        raise RuntimeError("Input JSON must contain an 'items' array.")

    rows: list[AcceptanceCase] = []
    for idx, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise RuntimeError(f"items[{idx}] is not an object.")

        qid = str(raw.get("id", "")).strip()
        question = str(raw.get("question", "")).strip()
        if not qid:
            raise RuntimeError(f"items[{idx}] missing non-empty 'id'.")
        if not question:
            raise RuntimeError(f"items[{idx}] missing non-empty 'question'.")

        raw_expected = raw.get("expected_accepted")
        label = str(raw.get("label")).strip().lower() if raw.get("label") is not None else None

        if isinstance(raw_expected, bool):
            expected_accepted = raw_expected
            raw_expected_bool = raw_expected
        elif raw_expected is None:
            # Dataset sometimes uses null + label=unsupported; treat as not accepted.
            expected_accepted = False
            raw_expected_bool = None
        else:
            raise RuntimeError(
                f"items[{idx}] has invalid 'expected_accepted' value: {raw_expected!r}. "
                "Expected true/false/null."
            )

        rows.append(
            AcceptanceCase(
                id=qid,
                question=question,
                expected_accepted=expected_accepted,
                raw_expected_accepted=raw_expected_bool,
                label=label,
                notes=str(raw.get("notes")).strip() if raw.get("notes") is not None else None,
            )
        )
    return rows


def _extract_observed(payload: dict[str, Any] | None) -> tuple[bool, str | None, str | None, bool | None]:
    if not isinstance(payload, dict):
        return False, None, None, None

    status = payload.get("status") if isinstance(payload.get("status"), str) else None
    assistant = payload.get("assistantMessage")
    retrieval_meta: dict[str, Any] | None = None
    if isinstance(assistant, dict) and isinstance(assistant.get("retrievalMeta"), dict):
        retrieval_meta = assistant["retrievalMeta"]

    if status is None and retrieval_meta and isinstance(retrieval_meta.get("status"), str):
        status = retrieval_meta["status"]

    route_family = (
        retrieval_meta.get("routeFamily")
        if retrieval_meta and isinstance(retrieval_meta.get("routeFamily"), str)
        else None
    )
    refused = retrieval_meta.get("refused") if retrieval_meta else None
    refused_bool = refused if isinstance(refused, bool) else None

    observed_accepted = status == "answer" and refused_bool is not True
    return observed_accepted, status, route_family, refused_bool


def main() -> int:
    args = parse_args()
    input_path = _resolve_path(args.input)
    out_root = _resolve_path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    cases = _read_cases(input_path)
    if args.max is not None:
        if args.max <= 0:
            print("Configuration error: --max must be > 0.")
            return 1
        cases = cases[: args.max]

    if args.dry_run:
        print(f"Dry run PASS: {len(cases)} cases loaded from {input_path}")
        return 0

    base_url = args.base_url or os.getenv("OPENAIP_WEBSITE_BASE_URL")
    token = args.token or os.getenv("OPENAIP_EVAL_BEARER_TOKEN")
    cookie_header = args.cookie_header or os.getenv("OPENAIP_EVAL_COOKIE_HEADER")
    origin_header = args.origin or os.getenv("OPENAIP_EVAL_ORIGIN")
    referer_header = args.referer or os.getenv("OPENAIP_EVAL_REFERER")
    if not base_url:
        print("Configuration error: --base-url or OPENAIP_WEBSITE_BASE_URL is required.")
        return 1
    if origin_header is None:
        origin_header = base_url.rstrip("/")
    if referer_header is None:
        referer_header = f"{base_url.rstrip('/')}/barangay/chatbot"

    run_id = _build_run_id()
    run_dir = out_root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    rows: list[dict[str, Any]] = []
    session_id: str | None = None
    with WebsiteChatClient(
        base_url=base_url,
        bearer_token=token,
        cookie_header=cookie_header,
        origin_header=origin_header,
        referer_header=referer_header,
    ) as client:
        for case in cases:
            result = client.post_message(content=case.question, session_id=session_id if args.stateful else None)
            body = result.json_body
            if args.stateful and isinstance(body, dict) and isinstance(body.get("sessionId"), str):
                session_id = body["sessionId"]

            observed_accepted, observed_status, observed_route, observed_refused = _extract_observed(body)
            matched = observed_accepted == case.expected_accepted

            rows.append(
                {
                    "id": case.id,
                    "question": case.question,
                    "label": case.label,
                    "raw_expected_accepted": case.raw_expected_accepted,
                    "expected_accepted": case.expected_accepted,
                    "observed_accepted": observed_accepted,
                    "match": matched,
                    "observed_status": observed_status,
                    "observed_route_family": observed_route,
                    "observed_refused": observed_refused,
                    "http_status": result.http_status,
                    "attempts": result.attempts,
                    "timing_ms": round(result.timing_ms, 2),
                    "error": result.error,
                }
            )

    total = len(rows)
    match_count = sum(1 for row in rows if row["match"] is True)
    mismatch_count = total - match_count

    expected_true = sum(1 for row in rows if row["expected_accepted"] is True)
    expected_false = total - expected_true
    observed_true = sum(1 for row in rows if row["observed_accepted"] is True)
    observed_false = total - observed_true

    tp = sum(
        1
        for row in rows
        if row["expected_accepted"] is True and row["observed_accepted"] is True
    )
    fp = sum(
        1
        for row in rows
        if row["expected_accepted"] is False and row["observed_accepted"] is True
    )
    fn = sum(
        1
        for row in rows
        if row["expected_accepted"] is True and row["observed_accepted"] is False
    )
    tn = sum(
        1
        for row in rows
        if row["expected_accepted"] is False and row["observed_accepted"] is False
    )

    precision = (tp / (tp + fp)) if (tp + fp) else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    acceptance_rate = observed_true / total if total else 0.0

    summary = {
        "run_id": run_id,
        "input_path": str(input_path),
        "base_url": base_url,
        "total": total,
        "match_count": match_count,
        "mismatch_count": mismatch_count,
        "match_rate": (match_count / total) if total else 0.0,
        "acceptance_rate": acceptance_rate,
        "acceptance_precision": precision,
        "acceptance_recall": recall,
        "acceptance_f1": f1,
        "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "counts": {
            "expected_accepted_true": expected_true,
            "expected_accepted_false": expected_false,
            "observed_accepted_true": observed_true,
            "observed_accepted_false": observed_false,
        },
        "command": "python " + " ".join(shlex.quote(part) for part in sys.argv),
    }

    summary_path = run_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    csv_path = run_dir / "detailed.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "question",
                "label",
                "raw_expected_accepted",
                "expected_accepted",
                "observed_accepted",
                "match",
                "observed_status",
                "observed_route_family",
                "observed_refused",
                "http_status",
                "attempts",
                "timing_ms",
                "error",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    mismatches_path = run_dir / "mismatches.csv"
    with mismatches_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "question",
                "label",
                "expected_accepted",
                "observed_accepted",
                "observed_status",
                "observed_route_family",
                "observed_refused",
                "http_status",
                "error",
            ],
        )
        writer.writeheader()
        for row in rows:
            if row["match"] is True:
                continue
            writer.writerow(
                {
                    "id": row["id"],
                    "question": row["question"],
                    "label": row["label"],
                    "expected_accepted": row["expected_accepted"],
                    "observed_accepted": row["observed_accepted"],
                    "observed_status": row["observed_status"],
                    "observed_route_family": row["observed_route_family"],
                    "observed_refused": row["observed_refused"],
                    "http_status": row["http_status"],
                    "error": row["error"],
                }
            )

    print(f"Total: {total}")
    print(f"Match: {match_count}")
    print(f"Mismatch: {mismatch_count}")
    print(f"Match rate: {summary['match_rate']:.2%}")
    print(f"Acceptance rate (observed): {acceptance_rate:.2%}")
    print(f"Acceptance F1: {f1:.4f}")
    print(f"Results written to: {run_dir}")
    return 0 if mismatch_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
