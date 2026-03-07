from __future__ import annotations

import argparse
import csv
import json
import os
import shlex
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval.lib.http_client import WebsiteChatClient

EXPECTED_OUTCOMES = {
    "in_scope_answerable",
    "in_scope_no_data",
    "out_of_scope",
    "in_scope_ambiguous",
}

CORE_OUTCOMES = {
    "in_scope_answerable",
    "in_scope_no_data",
    "out_of_scope",
}

NO_DATA_REFUSAL_REASONS = {"document_limitation", "retrieval_failure"}
AMBIGUOUS_REFUSAL_REASONS = {"ambiguous_scope", "missing_required_parameter"}


@dataclass(frozen=True)
class ScopeOutcomeCase:
    id: str
    question: str
    expected_outcome: str
    notes: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run out-of-scope vs no-data outcome checks against website chat API."
    )
    parser.add_argument("--input", type=Path, required=True, help="Path to scope-outcome JSON file.")
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
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-scope-outcome")


def _read_cases(path: Path) -> tuple[str, list[ScopeOutcomeCase]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Input file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {path}: {exc}") from exc

    version = payload.get("version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError("Input JSON must contain non-empty string field 'version'.")

    items = payload.get("items")
    if not isinstance(items, list):
        raise RuntimeError("Input JSON must contain an 'items' array.")

    rows: list[ScopeOutcomeCase] = []
    for idx, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise RuntimeError(f"items[{idx}] is not an object.")

        qid = str(raw.get("id", "")).strip()
        question = str(raw.get("question", "")).strip()
        expected_outcome = str(raw.get("expected_outcome", "")).strip()
        notes = str(raw.get("notes")).strip() if raw.get("notes") is not None else None

        if not qid:
            raise RuntimeError(f"items[{idx}] missing non-empty 'id'.")
        if not question:
            raise RuntimeError(f"items[{idx}] missing non-empty 'question'.")
        if expected_outcome not in EXPECTED_OUTCOMES:
            raise RuntimeError(
                f"items[{idx}] has invalid expected_outcome={expected_outcome!r}. "
                f"Expected one of: {sorted(EXPECTED_OUTCOMES)}."
            )

        rows.append(
            ScopeOutcomeCase(
                id=qid,
                question=question,
                expected_outcome=expected_outcome,
                notes=notes,
            )
        )

    return version, rows


def _extract_status_and_meta(
    payload: dict[str, Any] | None,
) -> tuple[str | None, dict[str, Any] | None]:
    if not isinstance(payload, dict):
        return None, None

    assistant = payload.get("assistantMessage")
    retrieval_meta: dict[str, Any] | None = None
    if isinstance(assistant, dict) and isinstance(assistant.get("retrievalMeta"), dict):
        retrieval_meta = assistant["retrievalMeta"]

    status = payload.get("status") if isinstance(payload.get("status"), str) else None
    if status is None and isinstance(retrieval_meta, dict):
        status_meta = retrieval_meta.get("status")
        status = status_meta if isinstance(status_meta, str) else None

    return status, retrieval_meta


def _extract_refusal_reason(status: str | None, retrieval_meta: dict[str, Any] | None) -> str | None:
    if not isinstance(retrieval_meta, dict):
        return None

    for key in ("refusalReason", "refusal_reason"):
        raw = retrieval_meta.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw

    if status == "refusal":
        raw_reason = retrieval_meta.get("reason")
        if isinstance(raw_reason, str) and raw_reason.strip():
            return raw_reason

    return None


def _looks_like_html(raw_text: str | None) -> bool:
    if not isinstance(raw_text, str):
        return False
    lowered = raw_text.lstrip().lower()
    return lowered.startswith("<!doctype html") or lowered.startswith("<html")


def classify_observed_outcome(
    *,
    payload: dict[str, Any] | None,
    http_status: int | None,
    raw_text: str | None,
    error: str | None,
) -> tuple[str, str | None, str | None, str | None]:
    if error:
        return "instrumentation_error", None, None, "client_error"

    if http_status is None:
        return "instrumentation_error", None, None, "missing_http_status"

    if not isinstance(payload, dict):
        if _looks_like_html(raw_text):
            return "instrumentation_error", None, None, "html_login_or_redirect"
        if isinstance(raw_text, str) and raw_text.strip():
            return "instrumentation_error", None, None, "non_json_response"
        if http_status != 200:
            return "instrumentation_error", None, None, f"http_{http_status}_without_json"
        return "unknown_outcome", None, None, "missing_json_payload"

    if http_status != 200:
        return "instrumentation_error", None, None, f"http_{http_status}_with_json"

    status, retrieval_meta = _extract_status_and_meta(payload)
    refusal_reason = _extract_refusal_reason(status, retrieval_meta)
    refused = retrieval_meta.get("refused") if isinstance(retrieval_meta, dict) else None
    refused_bool = refused if isinstance(refused, bool) else None

    if status == "answer" and refused_bool is not True:
        return "in_scope_answerable", status, refusal_reason, None

    if status == "refusal" and refusal_reason == "unsupported_request":
        return "out_of_scope", status, refusal_reason, None

    if status == "refusal" and refusal_reason in NO_DATA_REFUSAL_REASONS:
        return "in_scope_no_data", status, refusal_reason, None

    if status == "clarification" or refusal_reason in AMBIGUOUS_REFUSAL_REASONS:
        return "in_scope_ambiguous", status, refusal_reason, None

    return "unknown_outcome", status, refusal_reason, None


def build_summary(rows: list[dict[str, Any]], *, run_id: str, input_path: Path, base_url: str) -> dict[str, Any]:
    total = len(rows)
    pass_count = sum(1 for row in rows if row["match"] is True)
    fail_count = total - pass_count

    core_rows = [row for row in rows if row["expected_outcome"] in CORE_OUTCOMES]
    core_total = len(core_rows)
    core_pass = sum(1 for row in core_rows if row["match"] is True)
    core_fail = core_total - core_pass

    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    refusal_reason_distribution: Counter[str] = Counter()
    observed_outcomes: Counter[str] = Counter()
    expected_outcomes: Counter[str] = Counter()

    for row in rows:
        expected = row["expected_outcome"]
        observed = row["observed_outcome"]
        confusion[expected][observed] += 1
        expected_outcomes[expected] += 1
        observed_outcomes[observed] += 1
        if isinstance(row.get("observed_refusal_reason"), str):
            refusal_reason_distribution[row["observed_refusal_reason"]] += 1

    http_error_count = sum(
        1 for row in rows if not isinstance(row.get("http_status"), int) or row["http_status"] != 200
    )
    non_json_count = sum(1 for row in rows if row.get("json_payload_present") is False)

    summary = {
        "run_id": run_id,
        "input_path": str(input_path),
        "base_url": base_url,
        "total": total,
        "pass": pass_count,
        "fail": fail_count,
        "pass_rate": (pass_count / total) if total else 0.0,
        "core_total": core_total,
        "core_pass": core_pass,
        "core_fail": core_fail,
        "core_pass_rate": (core_pass / core_total) if core_total else 0.0,
        "counts": {
            "expected_outcome_counts": dict(expected_outcomes),
            "observed_outcome_counts": dict(observed_outcomes),
            "in_scope_ambiguous_count": observed_outcomes.get("in_scope_ambiguous", 0),
            "unknown_outcome_count": observed_outcomes.get("unknown_outcome", 0),
            "instrumentation_error_count": observed_outcomes.get("instrumentation_error", 0),
            "http_error_count": http_error_count,
            "non_json_count": non_json_count,
        },
        "confusion": {
            "expected_vs_observed_outcome": {
                expected: dict(observed_counts)
                for expected, observed_counts in sorted(confusion.items(), key=lambda item: item[0])
            }
        },
        "refusal_reason_distribution": dict(refusal_reason_distribution),
        "command": "python " + " ".join(shlex.quote(part) for part in sys.argv),
    }
    return summary


def main() -> int:
    args = parse_args()
    input_path = _resolve_path(args.input)
    out_root = _resolve_path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    version, cases = _read_cases(input_path)
    if args.max is not None:
        if args.max <= 0:
            print("Configuration error: --max must be > 0.")
            return 1
        cases = cases[: args.max]

    if args.dry_run:
        print(f"Dry run PASS: {len(cases)} cases loaded from {input_path} (version={version})")
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

            (
                observed_outcome,
                observed_status,
                observed_refusal_reason,
                instrumentation_reason,
            ) = classify_observed_outcome(
                payload=body,
                http_status=result.http_status,
                raw_text=result.raw_text,
                error=result.error,
            )

            rows.append(
                {
                    "id": case.id,
                    "question": case.question,
                    "expected_outcome": case.expected_outcome,
                    "observed_outcome": observed_outcome,
                    "match": observed_outcome == case.expected_outcome,
                    "observed_status": observed_status,
                    "observed_refusal_reason": observed_refusal_reason,
                    "instrumentation_reason": instrumentation_reason,
                    "http_status": result.http_status,
                    "attempts": result.attempts,
                    "timing_ms": round(result.timing_ms, 2),
                    "error": result.error,
                    "json_payload_present": isinstance(body, dict),
                    "notes": case.notes,
                }
            )

    summary = build_summary(rows, run_id=run_id, input_path=input_path, base_url=base_url)
    summary["dataset_version"] = version

    summary_path = run_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    csv_path = run_dir / "detailed.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "question",
                "expected_outcome",
                "observed_outcome",
                "match",
                "observed_status",
                "observed_refusal_reason",
                "instrumentation_reason",
                "http_status",
                "attempts",
                "timing_ms",
                "error",
                "json_payload_present",
                "notes",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    mismatch_path = run_dir / "mismatches.csv"
    with mismatch_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "question",
                "expected_outcome",
                "observed_outcome",
                "observed_status",
                "observed_refusal_reason",
                "instrumentation_reason",
                "http_status",
                "error",
            ],
        )
        writer.writeheader()
        for row in rows:
            if row["match"]:
                continue
            writer.writerow(
                {
                    "id": row["id"],
                    "question": row["question"],
                    "expected_outcome": row["expected_outcome"],
                    "observed_outcome": row["observed_outcome"],
                    "observed_status": row["observed_status"],
                    "observed_refusal_reason": row["observed_refusal_reason"],
                    "instrumentation_reason": row["instrumentation_reason"],
                    "http_status": row["http_status"],
                    "error": row["error"],
                }
            )

    print(f"Dataset version: {version}")
    print(f"Total: {summary['total']}")
    print(f"Pass: {summary['pass']}")
    print(f"Fail: {summary['fail']}")
    print(f"Pass rate: {summary['pass_rate']:.2%}")
    print(f"Core pass rate (excluding expected ambiguous): {summary['core_pass_rate']:.2%}")
    print(f"Results written to: {run_dir}")

    return 0 if summary["fail"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
