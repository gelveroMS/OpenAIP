import type { CitizenProjectFeedbackKind } from "@/features/projects/shared/feedback";

export type AipFeedbackDisplayKind =
  | "commend"
  | "suggestion"
  | "concern"
  | "question"
  | "lgu_note";

export type AipFeedbackAuthorRole =
  | "citizen"
  | "barangay_official"
  | "city_official"
  | "municipal_official"
  | "admin";

export type AipFeedbackItem = {
  id: string;
  aipId: string;
  parentFeedbackId: string | null;
  kind: AipFeedbackDisplayKind;
  isHidden?: boolean;
  body: string;
  hiddenReason?: string | null;
  violationCategory?: string | null;
  createdAt: string;
  author: {
    id: string | null;
    fullName: string;
    role: AipFeedbackAuthorRole;
    roleLabel: string;
    lguLabel: string;
  };
};

export class AipFeedbackRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Request failed.";
  const candidate = (payload as { error?: unknown; message?: unknown }).error;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  const fallback = (payload as { message?: unknown }).message;
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return "Request failed.";
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AipFeedbackRequestError(response.status, readErrorMessage(payload));
  }
  if (!payload) {
    throw new AipFeedbackRequestError(500, "Missing response payload.");
  }
  return payload as T;
}

export async function listAipFeedback(aipId: string): Promise<{ items: AipFeedbackItem[] }> {
  return requestJson<{ items: AipFeedbackItem[] }>(
    `/api/citizen/aips/${encodeURIComponent(aipId)}/feedback`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
}

export async function createCitizenAipFeedback(
  aipId: string,
  payload: { kind: CitizenProjectFeedbackKind; body: string }
): Promise<{ item: AipFeedbackItem }> {
  return requestJson<{ item: AipFeedbackItem }>(
    `/api/citizen/aips/${encodeURIComponent(aipId)}/feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function createCitizenAipFeedbackReply(
  aipId: string,
  payload: {
    parentFeedbackId: string;
    kind: CitizenProjectFeedbackKind;
    body: string;
  }
): Promise<{ item: AipFeedbackItem }> {
  return requestJson<{ item: AipFeedbackItem }>(
    `/api/citizen/aips/${encodeURIComponent(aipId)}/feedback/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function createScopedAipFeedbackReply(input: {
  scope: "barangay" | "city";
  aipId: string;
  parentFeedbackId: string;
  body: string;
}): Promise<{ item: AipFeedbackItem }> {
  return requestJson<{ item: AipFeedbackItem }>(
    `/api/${input.scope}/aips/${encodeURIComponent(input.aipId)}/feedback/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFeedbackId: input.parentFeedbackId,
        body: input.body,
      }),
    }
  );
}

export function normalizeAipFeedbackApiError(error: unknown, fallback: string): string {
  if (error instanceof AipFeedbackRequestError) return error.message;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}
