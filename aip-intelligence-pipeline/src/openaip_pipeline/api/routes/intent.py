from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from openaip_pipeline.api.routes.chat_auth import chat_auth_dependency
from openaip_pipeline.core.settings import Settings
from openaip_pipeline.services.intent import IntentClassificationError, classify_message

router = APIRouter(prefix="/v1/intent", tags=["intent"], dependencies=[Depends(chat_auth_dependency)])


class IntentEntities(BaseModel):
    barangay: str | None = None
    city: str | None = None
    fiscal_year: int | None = None
    topic: str | None = None
    project_type: str | None = None
    sector: str | None = None
    budget_term: str | None = None
    scope_name: str | None = None
    scope_type: Literal["barangay", "city", "municipality"] | None = None


class IntentClassifyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    model_name: str | None = None


class IntentClassifyResponse(BaseModel):
    intent: str
    confidence: float
    needs_retrieval: bool
    friendly_response: str | None
    entities: IntentEntities
    route_hint: str | None
    classifier_method: str


@router.post("/classify", response_model=IntentClassifyResponse)
def classify_intent(req: IntentClassifyRequest) -> IntentClassifyResponse:
    settings = Settings.load(require_supabase=False, require_openai=False)
    intent_model_override = (req.model_name or "").strip()

    try:
        result = classify_message(
            message=req.message,
            openai_api_key=settings.openai_api_key,
            default_model=intent_model_override,
        )
    except IntentClassificationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    payload = result.to_dict()
    entities = payload.get("entities") if isinstance(payload.get("entities"), dict) else {}
    normalized_entities: dict[str, Any] = {
        "barangay": entities.get("barangay"),
        "city": entities.get("city"),
        "fiscal_year": entities.get("fiscal_year"),
        "topic": entities.get("topic"),
        "project_type": entities.get("project_type"),
        "sector": entities.get("sector"),
        "budget_term": entities.get("budget_term"),
        "scope_name": entities.get("scope_name"),
        "scope_type": entities.get("scope_type"),
    }

    return IntentClassifyResponse(
        intent=str(payload.get("intent") or ""),
        confidence=float(payload.get("confidence") or 0.0),
        needs_retrieval=bool(payload.get("needs_retrieval")),
        friendly_response=payload.get("friendly_response")
        if isinstance(payload.get("friendly_response"), str)
        else None,
        entities=IntentEntities(**normalized_entities),
        route_hint=payload.get("route_hint") if isinstance(payload.get("route_hint"), str) else None,
        classifier_method=str(payload.get("classifier_method") or ""),
    )
