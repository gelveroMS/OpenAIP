from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ExtractionRunDTO:
    id: str
    aip_id: str
    uploaded_file_id: str | None
    retry_of_run_id: str | None
    resume_from_stage: str | None
    model_name: str | None
    status: str
    stage: str
    created_at: str | None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "ExtractionRunDTO":
        return cls(
            id=str(row["id"]),
            aip_id=str(row["aip_id"]),
            uploaded_file_id=row.get("uploaded_file_id"),
            retry_of_run_id=row.get("retry_of_run_id"),
            resume_from_stage=row.get("resume_from_stage"),
            model_name=row.get("model_name"),
            status=str(row.get("status") or ""),
            stage=str(row.get("stage") or ""),
            created_at=row.get("created_at"),
        )


@dataclass
class UploadedFileDTO:
    id: str
    aip_id: str
    bucket_id: str
    object_name: str
    original_file_name: str | None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "UploadedFileDTO":
        return cls(
            id=str(row["id"]),
            aip_id=str(row["aip_id"]),
            bucket_id=str(row["bucket_id"]),
            object_name=str(row["object_name"]),
            original_file_name=row.get("original_file_name"),
        )

