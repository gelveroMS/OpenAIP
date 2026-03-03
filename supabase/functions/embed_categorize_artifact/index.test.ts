import { assert, assertEquals } from "jsr:@std/assert@1";

import { buildChunkPlan, handleRequest } from "./index.ts";

async function signJob(args: {
  secret: string;
  aud: string;
  ts: string;
  nonce: string;
  rawBody: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${args.aud}|${args.ts}|${args.nonce}|${args.rawBody}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildSignedRequest(args: {
  secret?: string;
  aud?: string;
  ts?: string;
  nonce?: string;
  body: Record<string, unknown>;
  overrideSig?: string;
}): Promise<Request> {
  const secret = args.secret ?? "expected-secret";
  const aud = args.aud ?? "embed-categorize-dispatcher";
  const ts = args.ts ?? Math.floor(Date.now() / 1000).toString();
  const nonce = args.nonce ?? crypto.randomUUID();
  const rawBody = JSON.stringify(args.body);
  const sig =
    args.overrideSig ??
    (await signJob({
      secret,
      aud,
      ts,
      nonce,
      rawBody,
    }));

  return new Request("http://localhost/embed_categorize_artifact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-job-ts": ts,
      "x-job-nonce": nonce,
      "x-job-sig": sig,
    },
    body: rawBody,
  });
}

Deno.test("buildChunkPlan is deterministic for identical categorize input", () => {
  const args = {
    projectsRaw: [
      {
        aip_ref_code: "1000-2026-001",
        program_project_description: "Primary care expansion",
        source_of_funds: "General Fund",
        amounts: {
          personal_services: 100000,
          maintenance_and_other_operating_expenses: 200000,
          financial_expenses: 0,
          capital_outlay: 300000,
          total: 600000,
        },
        classification: {
          sector_code: "1000",
          category: "health",
        },
      },
      {
        aip_ref_code: "3000-2026-010",
        program_project_description: "Road rehabilitation and drainage works",
        source_of_funds: "Local Development Fund",
        amounts: {
          personal_services: 0,
          maintenance_and_other_operating_expenses: 100000,
          financial_expenses: 0,
          capital_outlay: 900000,
          total: 1000000,
        },
        classification: {
          sector_code: "3000",
          category: "infrastructure",
        },
      },
    ],
    context: {
      fiscalYear: 2026,
      scopeType: "barangay" as const,
      scopeId: "scope-id",
      scopeLabel: "Barangay: Mamatid",
    },
    artifactId: "artifact-id-123",
    artifactRunId: "run-id-123",
    aipId: "aip-id-123",
    scopeType: "barangay" as const,
    scopeId: "scope-id",
    sectorLabels: new Map<string, string>([
      ["1000", "General Services"],
      ["3000", "Social Services"],
      ["unknown", "Unknown Sector"],
    ]),
  };

  const first = buildChunkPlan(args);
  const second = buildChunkPlan(args);

  assertEquals(first, second);
  assertEquals(first.length, 2);
  assertEquals(first[0]?.chunkIndex, 0);
  assertEquals(first[1]?.chunkIndex, 1);
  assertEquals(first[0]?.metadata.chunk_kind, "project");
  assertEquals(first[1]?.metadata.chunk_kind, "project");
});

Deno.test("buildChunkPlan groups by category when per-project chunks are too short", () => {
  const projectsRaw = Array.from({ length: 8 }).map((_, idx) => ({
    aip_ref_code: `${idx % 2 === 0 ? "1000" : "3000"}-2026-00${idx + 1}`,
    program_project_description: `Short desc ${idx + 1}`,
    source_of_funds: "General Fund",
    amounts: {
      personal_services: 1,
      maintenance_and_other_operating_expenses: 2,
      financial_expenses: 3,
      capital_outlay: 4,
      total: 10,
    },
    classification: {
      sector_code: idx % 2 === 0 ? "1000" : "3000",
      category: idx % 2 === 0 ? "health" : "infrastructure",
    },
  }));

  const chunks = buildChunkPlan({
    projectsRaw,
    context: {
      fiscalYear: 2026,
      scopeType: "city" as const,
      scopeId: "scope-id",
      scopeLabel: "City: Sample",
    },
    artifactId: "artifact-id-456",
    artifactRunId: "run-id-456",
    aipId: "aip-id-456",
    scopeType: "city" as const,
    scopeId: "scope-id",
    sectorLabels: new Map<string, string>([
      ["1000", "General Services"],
      ["3000", "Social Services"],
      ["unknown", "Unknown Sector"],
    ]),
  });

  assert(chunks.length > 0);
  assertEquals(chunks[0]?.metadata.chunk_kind, "category_group");
});

Deno.test("handleRequest rejects unsigned requests", async () => {
  Deno.env.set("EMBED_CATEGORIZE_JOB_SECRET", "expected-secret");
  Deno.env.set("EMBED_CATEGORIZE_JOB_AUDIENCE", "embed-categorize-dispatcher");

  const req = new Request("http://localhost/embed_categorize_artifact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aip_id: "aip-id-789" }),
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejects invalid signature", async () => {
  Deno.env.set("EMBED_CATEGORIZE_JOB_SECRET", "expected-secret");
  Deno.env.set("EMBED_CATEGORIZE_JOB_AUDIENCE", "embed-categorize-dispatcher");

  const req = await buildSignedRequest({
    body: {
      aip_id: "aip-id-789",
      request_id: crypto.randomUUID(),
    },
    overrideSig: "00",
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejects stale timestamp", async () => {
  Deno.env.set("EMBED_CATEGORIZE_JOB_SECRET", "expected-secret");
  Deno.env.set("EMBED_CATEGORIZE_JOB_AUDIENCE", "embed-categorize-dispatcher");

  const staleTs = (Math.floor(Date.now() / 1000) - 120).toString();
  const req = await buildSignedRequest({
    ts: staleTs,
    body: {
      aip_id: "aip-id-789",
      request_id: crypto.randomUUID(),
    },
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejects replayed nonce", async () => {
  Deno.env.set("EMBED_CATEGORIZE_JOB_SECRET", "expected-secret");
  Deno.env.set("EMBED_CATEGORIZE_JOB_AUDIENCE", "embed-categorize-dispatcher");

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const body = { aip_id: "aip-id-789" };

  const firstReq = await buildSignedRequest({ ts, nonce, body });
  const firstRes = await handleRequest(firstReq);
  assertEquals(firstRes.status, 400);

  const secondReq = await buildSignedRequest({ ts, nonce, body });
  const secondRes = await handleRequest(secondReq);
  assertEquals(secondRes.status, 401);
});

Deno.test("handleRequest requires request_id or artifact_id", async () => {
  Deno.env.set("EMBED_CATEGORIZE_JOB_SECRET", "expected-secret");
  Deno.env.set("EMBED_CATEGORIZE_JOB_AUDIENCE", "embed-categorize-dispatcher");

  const req = await buildSignedRequest({
    body: { aip_id: "aip-id-789" },
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 400);
});
