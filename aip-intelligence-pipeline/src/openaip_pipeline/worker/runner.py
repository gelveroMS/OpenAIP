from __future__ import annotations

import time

from dotenv import load_dotenv

from openaip_pipeline.adapters.supabase.client import SupabaseRestClient
from openaip_pipeline.adapters.supabase.repositories import PipelineRepository, ProgressTrackingReadinessError
from openaip_pipeline.core.logging import configure_logging
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.worker.processor import process_run


def _assert_progress_tracking_ready_with_retries(repo: PipelineRepository) -> None:
    backoff_seconds = (2, 4, 8)
    for attempt in range(len(backoff_seconds) + 1):
        try:
            repo.assert_progress_tracking_ready()
            return
        except ProgressTrackingReadinessError as error:
            if not error.retryable or attempt >= len(backoff_seconds):
                raise
            delay_seconds = backoff_seconds[attempt]
            print(
                (
                    "[WORKER] startup readiness check failed "
                    f"(reason_code={error.reason_code}, retryable=true, attempt={attempt + 1}); "
                    f"retrying in {delay_seconds}s: {error}"
                )
            )
            time.sleep(delay_seconds)


def run_worker() -> None:
    settings = Settings.load(require_supabase=True, require_openai=True)
    client = SupabaseRestClient.from_settings(settings)
    repo = PipelineRepository(client)
    _assert_progress_tracking_ready_with_retries(repo)
    print("[WORKER] started")
    while True:
        run = repo.claim_next_queued_run()
        if not run:
            if settings.worker_run_once:
                print("[WORKER] no queued runs; exiting (run once)")
                return
            time.sleep(settings.worker_poll_seconds)
            continue
        print(f"[WORKER] claimed run {run.id}")
        process_run(repo=repo, settings=settings, run=run.__dict__)
        if settings.worker_run_once:
            return


def main() -> None:
    # Prefer project-local developer config while still allowing .env defaults.
    load_dotenv(".env.local")
    load_dotenv()
    configure_logging()
    run_worker()


if __name__ == "__main__":
    main()

