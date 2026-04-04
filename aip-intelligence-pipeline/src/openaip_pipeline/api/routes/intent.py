from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from openaip_pipeline.services.intent import IntentRouter

MAX_INTENT_TEXT_LENGTH = 2000

def _load_intent_token() -> str:
    token = os.getenv("PIPELINE_INTERNAL_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=500, detail="PIPELINE_INTERNAL_TOKEN is not configured.")
    return token


async def _require_intent_token_auth(request: Request) -> None:
    provided = (request.headers.get("x-pipeline-token") or "").strip()
    if not provided:
        raise HTTPException(status_code=401, detail="Unauthorized.")

    expected = _load_intent_token()
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


router = APIRouter(prefix="/intent", tags=["intent"], dependencies=[Depends(_require_intent_token_auth)])

_INTENT_ROUTER = IntentRouter()


class IntentClassifyRequest(BaseModel):
    text: str


@router.post("/classify")
def classify_intent(payload: IntentClassifyRequest) -> dict[str, str | float | None]:
    text = payload.text
    # Truncate oversized payloads instead of rejecting them to keep the endpoint easy to consume.
    if len(text) > MAX_INTENT_TEXT_LENGTH:
        text = text[:MAX_INTENT_TEXT_LENGTH]

    result = _INTENT_ROUTER.route(text)
    return result.to_dict()
