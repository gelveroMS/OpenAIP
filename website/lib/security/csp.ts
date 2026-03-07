import type { NextResponse } from "next/server";

export const CSP_NONCE_HEADER = "x-csp-nonce";
export const NEXT_NONCE_HEADER = "x-nonce";

type SecurityHeaderOptions = {
  isProduction: boolean;
  nonce: string;
};

type CspOptions = SecurityHeaderOptions & {
  connectSrcAllowlist: string[];
};

function originFromEnv(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
      return parsed.origin;
    }
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function buildConnectSrcAllowlist(isProduction: boolean): string[] {
  const allowlist = new Set<string>(["'self'"]);

  // Browser data plane: Supabase project endpoint used by auth + APIs.
  const supabaseOrigin = originFromEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (supabaseOrigin) {
    allowlist.add(supabaseOrigin);
    const wsOrigin = toWebSocketOrigin(supabaseOrigin);
    if (wsOrigin) allowlist.add(wsOrigin);
  }

  // Server-side data plane endpoint (kept explicit per requirement).
  const pipelineOrigin = originFromEnv(process.env.PIPELINE_API_BASE_URL);
  if (pipelineOrigin) {
    allowlist.add(pipelineOrigin);
    const wsOrigin = toWebSocketOrigin(pipelineOrigin);
    if (wsOrigin) allowlist.add(wsOrigin);
  }

  // Optional browser origins used by CSRF policy and staged deployments.
  const siteOrigin = originFromEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (siteOrigin) allowlist.add(siteOrigin);
  const stagingOrigin = originFromEnv(process.env.NEXT_PUBLIC_STAGING_URL);
  if (stagingOrigin) allowlist.add(stagingOrigin);
  const baseOrigin = originFromEnv(process.env.BASE_URL);
  if (baseOrigin) allowlist.add(baseOrigin);

  if (!isProduction) {
    allowlist.add("http://localhost:3000");
    allowlist.add("http://127.0.0.1:3000");
    allowlist.add("ws://localhost:3000");
    allowlist.add("ws://127.0.0.1:3000");
  }

  return Array.from(allowlist);
}

function buildContentSecurityPolicy(input: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${input.nonce}'`, "'strict-dynamic'"];
  if (!input.isProduction) {
    // Required by Next.js dev tooling for source maps and error overlay.
    scriptSrc.push("'unsafe-eval'");
  }

  // Keep style nonce for nonce-capable style tags, but allow inline styles
  // for runtime style attributes used by React/UI libraries in production.
  const styleSrc = ["'self'", `'nonce-${input.nonce}'`, "'unsafe-inline'"];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["script-src", scriptSrc],
    ["style-src", styleSrc],
    // Framer Motion and some Radix primitives use style attributes at runtime.
    ["style-src-attr", ["'unsafe-inline'"]],
    [
      "img-src",
      [
        "'self'",
        "data:",
        "blob:",
        "https://*.tile.openstreetmap.org",
        "https://unpkg.com/leaflet@1.9.4/dist/images/",
      ],
    ],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", input.connectSrcAllowlist],
    ["form-action", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["manifest-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
  ];

  if (input.isProduction) {
    directives.push(["upgrade-insecure-requests", []]);
  }

  return directives
    .map(([directive, sources]) =>
      sources.length > 0 ? `${directive} ${sources.join(" ")}` : directive
    )
    .join("; ");
}

export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function getRequestNonce(request: Pick<Request, "headers">): string | null {
  return request.headers.get(CSP_NONCE_HEADER) ?? request.headers.get(NEXT_NONCE_HEADER);
}

export function withSecurityHeaders(
  response: NextResponse | Response,
  options: SecurityHeaderOptions
): void {
  const connectSrcAllowlist = buildConnectSrcAllowlist(options.isProduction);
  const csp = buildContentSecurityPolicy({
    ...options,
    connectSrcAllowlist,
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  response.headers.set("X-Frame-Options", "DENY");

  if (options.isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  } else {
    response.headers.delete("Strict-Transport-Security");
  }
}
