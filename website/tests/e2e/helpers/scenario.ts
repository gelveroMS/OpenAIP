import fs from "node:fs";
import { getScenarioPathForProject } from "./env";

export type E2EScenario = {
  aipWorkflow: {
    uploadFiscalYear: number;
    revisionComment: string;
    resubmissionReply: string;
  };
  citizen: {
    feedbackMessage: string;
  };
  admin: {
    usageControls: {
      chatbotMaxRequests: number;
      chatbotTimeWindow: "per_hour" | "per_day";
    };
  };
};

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid scenario value for ${label}. Expected non-empty string.`);
  }
  return value.trim();
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid scenario value for ${label}. Expected number.`);
  }
  return value;
}

function parseScenario(raw: unknown): E2EScenario {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Scenario must be a JSON object.");
  }

  const input = raw as Record<string, unknown>;
  const aipWorkflow = input.aipWorkflow as Record<string, unknown> | undefined;
  const citizen = input.citizen as Record<string, unknown> | undefined;
  const admin = input.admin as Record<string, unknown> | undefined;

  if (!aipWorkflow || !citizen || !admin) {
    throw new Error("Scenario must contain aipWorkflow, citizen, and admin objects.");
  }

  const usageControls = admin.usageControls as Record<string, unknown> | undefined;
  if (!usageControls) {
    throw new Error("Scenario.admin must contain usageControls.");
  }

  return {
    aipWorkflow: {
      uploadFiscalYear: assertNumber(aipWorkflow.uploadFiscalYear, "aipWorkflow.uploadFiscalYear"),
      revisionComment: assertString(aipWorkflow.revisionComment, "aipWorkflow.revisionComment"),
      resubmissionReply: assertString(aipWorkflow.resubmissionReply, "aipWorkflow.resubmissionReply"),
    },
    citizen: {
      feedbackMessage: assertString(citizen.feedbackMessage, "citizen.feedbackMessage"),
    },
    admin: {
      usageControls: {
        chatbotMaxRequests: assertNumber(
          usageControls.chatbotMaxRequests,
          "admin.usageControls.chatbotMaxRequests"
        ),
        chatbotTimeWindow:
          usageControls.chatbotTimeWindow === "per_hour" ||
          usageControls.chatbotTimeWindow === "per_day"
            ? usageControls.chatbotTimeWindow
            : (() => {
                throw new Error(
                  "Invalid scenario value for admin.usageControls.chatbotTimeWindow. Expected per_hour or per_day."
                );
              })(),
      },
    },
  };
}

export function loadScenarioForProject(projectName: string): E2EScenario {
  const scenarioPath = getScenarioPathForProject(projectName);
  if (!fs.existsSync(scenarioPath)) {
    throw new Error(`Scenario file does not exist: ${scenarioPath}`);
  }
  const raw = fs.readFileSync(scenarioPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse scenario JSON at ${scenarioPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return parseScenario(parsed);
}
