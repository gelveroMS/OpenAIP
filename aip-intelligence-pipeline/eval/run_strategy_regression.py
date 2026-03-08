from __future__ import annotations

import argparse
import hashlib
import os
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval.lib.http_client import WebsiteChatClient
from eval.lib.strategy_io import (
    load_and_validate_strategy_cases,
    load_strategy_profiles,
)
from eval.lib.strategy_metrics import (
    build_strategy_summary,
    evaluate_strategy_result,
    extract_strategy_observed,
)
from eval.lib.strategy_reporting import (
    build_strategy_summary_payload,
    write_strategy_artifacts,
)
from eval.lib.strategy_types import StrategyEvalResult


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def build_run_id(input_sha256: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{timestamp}-{input_sha256[:8]}"


def ensure_run_dir(eval_root: Path, run_id: str) -> Path:
    run_dir = eval_root / "results" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run chat strategy regression cases against website API.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("eval/questions/strategy/v1/cases.jsonl"),
        help="Path to strategy cases JSONL.",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("eval/schema/chat-strategy.schema.json"),
        help="Path to strategy schema JSON.",
    )
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
    parser.add_argument("--cookie-header", type=str, default=None)
    parser.add_argument("--max", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--profile",
        type=str,
        default=None,
        help="Optional strategy profile label from eval/config/strategy_profiles.json",
    )
    parser.add_argument(
        "--profile-config",
        type=Path,
        default=Path("eval/config/strategy_profiles.json"),
        help="Path to strategy profiles JSON.",
    )
    parser.add_argument(
        "--stateful",
        action="store_true",
        help="Reuse one session per conversation_id bucket.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    eval_root = Path(__file__).resolve().parent
    input_path = _resolve_input_path(args.input)
    schema_path = _resolve_input_path(args.schema)

    cases = load_and_validate_strategy_cases(input_path=input_path, schema_path=schema_path)
    if args.max is not None:
        if args.max <= 0:
            print("Configuration error: --max must be greater than 0 when provided.")
            return 1
        cases = cases[: args.max]

    profile_flags: dict[str, bool] | None = None
    if args.profile:
        profiles = load_strategy_profiles(_resolve_input_path(args.profile_config))
        if args.profile not in profiles:
            print(f"Configuration error: unknown profile '{args.profile}'.")
            return 1
        profile_flags = profiles[args.profile].flags

    if args.dry_run:
        print(f"Dry run PASS: {len(cases)} strategy cases validated from {input_path}")
        return 0

    base_url = args.base_url or os.getenv("OPENAIP_WEBSITE_BASE_URL")
    token = args.token or os.getenv("OPENAIP_EVAL_BEARER_TOKEN")
    cookie_header = args.cookie_header or os.getenv("OPENAIP_EVAL_COOKIE_HEADER")
    if not base_url:
        print("Configuration error: --base-url or OPENAIP_WEBSITE_BASE_URL is required.")
        return 1

    input_sha256 = sha256_file(input_path)
    run_id = build_run_id(input_sha256) + "-strategy"
    run_dir = ensure_run_dir(eval_root, run_id)
    command_used = "python " + " ".join(shlex.quote(part) for part in sys.argv)

    session_by_conversation: dict[str, str] = {}
    results: list[StrategyEvalResult] = []

    with WebsiteChatClient(
        base_url=base_url,
        bearer_token=token,
        cookie_header=cookie_header,
    ) as client:
        for case in cases:
            session_id_used: str | None = None
            if args.stateful and case.conversation_id:
                session_id_used = session_by_conversation.get(case.conversation_id)

            http_result = client.post_message(content=case.question, session_id=session_id_used)
            payload = http_result.json_body
            if args.stateful and case.conversation_id and payload and isinstance(payload.get("sessionId"), str):
                session_by_conversation[case.conversation_id] = payload["sessionId"]

            observed = extract_strategy_observed(payload)
            eval_result = StrategyEvalResult(
                id=case.id,
                request={
                    "question": case.question,
                    "conversation_id": case.conversation_id,
                    "turn_index": case.turn_index,
                    "session_id_used": session_id_used,
                },
                response={
                    "http_status": http_result.http_status,
                    "json_body": payload,
                    "raw_text": http_result.raw_text,
                    "error": http_result.error,
                },
                observed=observed,
                pass_fail=False,
                mismatch_categories=[],
                errors=[],
                timing_ms=http_result.timing_ms,
                attempts=http_result.attempts,
            )
            if http_result.error:
                eval_result.errors.append(f"HTTP transport error: {http_result.error}")

            results.append(evaluate_strategy_result(case, eval_result))

    summary_metrics = build_strategy_summary(cases, results)
    summary_payload = build_strategy_summary_payload(
        summary_metrics=summary_metrics,
        run_id=run_id,
        command_used=command_used,
        base_url=base_url,
        auth_mode=_resolve_auth_mode(token, cookie_header),
        input_path=str(input_path),
        input_sha256=input_sha256,
        total_cases=len(cases),
        profile_name=args.profile,
        profile_flags=profile_flags,
    )

    write_strategy_artifacts(
        run_dir=run_dir,
        cases=cases,
        results=results,
        summary_payload=summary_payload,
        command_used=command_used,
        base_url=base_url,
        auth_mode=_resolve_auth_mode(token, cookie_header),
        input_path=str(input_path),
        input_sha256=input_sha256,
    )

    totals = summary_metrics["totals"]
    warnings = summary_metrics["instrumentation_warnings"]
    print(f"Total: {totals['total_case_count']}")
    print(f"Pass: {totals['pass_count']}")
    print(f"Fail: {totals['fail_count']}")
    print(f"Pass rate: {totals['pass_rate']:.2%}")
    print(f"Instrumentation warnings: {warnings}")
    print(f"Results written to: {run_dir}")

    return 0 if totals["fail_count"] == 0 else 2


def _resolve_input_path(path_arg: Path) -> Path:
    path = path_arg
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _resolve_auth_mode(token: str | None, cookie_header: str | None) -> str:
    if token and cookie_header:
        return "bearer+cookie"
    if token:
        return "bearer"
    if cookie_header:
        return "cookie"
    return "unauthenticated"


if __name__ == "__main__":
    raise SystemExit(main())
