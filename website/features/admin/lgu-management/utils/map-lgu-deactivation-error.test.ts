import { describe, expect, it } from "vitest";
import { mapLguDeactivationError } from "./map-lgu-deactivation-error";

describe("mapLguDeactivationError", () => {
  it("maps active-child constraint errors to friendly copy", () => {
    const mapped = mapLguDeactivationError(
      new Error("Cannot deactivate city while it still has active child LGUs.")
    );

    expect(mapped).toBe(
      "This LGU cannot be deactivated while it still has active child LGUs. Deactivate child LGUs first."
    );
  });

  it("maps unauthorized errors to permission copy", () => {
    const mapped = mapLguDeactivationError(new Error("Unauthorized."));

    expect(mapped).toBe("You do not have permission to deactivate LGUs.");
  });

  it("falls back to raw backend text for unknown errors", () => {
    const mapped = mapLguDeactivationError(
      new Error("Database timeout while updating LGU.")
    );

    expect(mapped).toBe("Database timeout while updating LGU.");
  });
});

