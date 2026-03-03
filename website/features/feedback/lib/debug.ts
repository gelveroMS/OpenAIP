type DebugPayload = Record<string, unknown>;

export function isFeedbackDebugEnabled() {
  return process.env.NEXT_PUBLIC_FEEDBACK_DEBUG === "1";
}

export function feedbackDebugLog(label: string, payload: DebugPayload) {
  if (!isFeedbackDebugEnabled()) return;
  console.debug(`[feedback][debug] ${label}`, payload);
}

