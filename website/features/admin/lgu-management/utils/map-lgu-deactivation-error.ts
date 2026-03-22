const DEACTIVATE_FALLBACK_ERROR = "Failed to deactivate LGU.";

const ACTIVE_CHILD_LGUS_ERROR = /cannot deactivate .*active child lgus|active children/i;
const UNAUTHORIZED_ERROR = /unauthorized/i;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  return "";
}

export function mapLguDeactivationError(error: unknown): string {
  const message = toErrorMessage(error);
  if (!message) return DEACTIVATE_FALLBACK_ERROR;

  if (ACTIVE_CHILD_LGUS_ERROR.test(message)) {
    return "This LGU cannot be deactivated while it still has active child LGUs. Deactivate child LGUs first.";
  }

  if (UNAUTHORIZED_ERROR.test(message)) {
    return "You do not have permission to deactivate LGUs.";
  }

  return message;
}

