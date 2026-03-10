from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path

from dotenv import load_dotenv

from openaip_pipeline.api.app import main as run_api_main
from openaip_pipeline.core.resources import read_yaml
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.core.versioning import resolve_version_bundle
from openaip_pipeline.services.categorization.categorize import (
    categorize_from_summarized_json_str,
    write_categorized_json_file,
)
from openaip_pipeline.services.extraction.barangay import run_extraction as run_barangay_extraction
from openaip_pipeline.services.extraction.city import run_extraction as run_city_extraction
from openaip_pipeline.services.scaling.scale_amounts import scale_validated_amounts_json_str
from openaip_pipeline.services.summarization.summarize import (
    summarize_aip_overall_json_str,
)
from openaip_pipeline.services.validation.barangay import validate_projects_json_str as validate_barangay
from openaip_pipeline.services.validation.city import validate_projects_json_str as validate_city
from openaip_pipeline.services.validation.rules_engine import load_rules
from openaip_pipeline.worker.runner import run_worker


def run_local_pipeline(pdf_path: str, scope: str, model: str, batch_size: int) -> dict[str, str]:
    run_id = str(uuid.uuid4())
    if scope == "city":
        extraction_res = run_city_extraction(pdf_path, model=model, job_id=run_id, aip_id=run_id, uploaded_file_id=None)
        validation_res = validate_city(extraction_res.json_str, model=model)
    else:
        extraction_res = run_barangay_extraction(
            pdf_path, model=model, job_id=run_id, aip_id=run_id, uploaded_file_id=None
        )
        validation_res = validate_barangay(extraction_res.json_str, model=model)
    scale_res = scale_validated_amounts_json_str(validation_res.validated_json_str, scope=scope)
    summary_res = summarize_aip_overall_json_str(scale_res.scaled_json_str, model=model)
    categorized_res = categorize_from_summarized_json_str(
        summary_res.summary_json_str,
        model=model,
        batch_size=batch_size,
    )
    out_dir = Path("data/outputs")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"aip_categorized.{run_id}.json"
    write_categorized_json_file(categorized_res.categorized_json_str, str(out_path))
    return {"run_id": run_id, "output_file": str(out_path), "summary": summary_res.summary_text}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OpenAIP pipeline CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    run_local = sub.add_parser("run-local", help="Run pipeline against a local PDF (dev-only).")
    run_local.add_argument("--pdf-path", required=True)
    run_local.add_argument("--scope", choices=["barangay", "city"], default="barangay")
    run_local.add_argument("--model", default="gpt-5.2")
    run_local.add_argument("--batch-size", type=int, default=25)

    worker_cmd = sub.add_parser("worker", help="Run queue worker.")
    worker_cmd.add_argument("--dry-run", action="store_true", help="Validate worker import/config without polling Supabase.")
    sub.add_parser("api", help="Run API service.")
    sub.add_parser("versions", help="Print resolved version metadata.")

    validate_rules = sub.add_parser("validate-rules", help="Load and print ruleset.")
    validate_rules.add_argument("--scope", choices=["barangay", "city"], default="barangay")

    sub.add_parser("manifest", help="Print pipeline version manifest.")
    return parser


def main() -> None:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "run-local":
        settings = Settings.load(require_openai=True, require_supabase=False)
        result = run_local_pipeline(args.pdf_path, args.scope, args.model or settings.pipeline_model, args.batch_size)
        print(json.dumps(result, indent=2))
        return

    if args.command == "worker":
        if getattr(args, "dry_run", False):
            settings = Settings.load(require_openai=False, require_supabase=False)
            print(json.dumps({"status": "ok", "worker_dry_run": True, "model": settings.pipeline_model}, indent=2))
            return
        run_worker()
        return

    if args.command == "api":
        run_api_main()
        return

    if args.command == "versions":
        bundle = resolve_version_bundle()
        print(json.dumps(bundle.__dict__, indent=2))
        return

    if args.command == "validate-rules":
        print(json.dumps(load_rules(args.scope), indent=2))
        return

    if args.command == "manifest":
        print(json.dumps(read_yaml("manifests/pipeline_versions.yaml"), indent=2))
        return

    parser.error(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
