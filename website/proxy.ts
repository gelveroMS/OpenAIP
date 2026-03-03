import { type NextRequest } from "next/server";
import {
  createCspNonce,
  CSP_NONCE_HEADER,
  NEXT_NONCE_HEADER,
  withSecurityHeaders,
} from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const extraHeaders = new Headers();
  extraHeaders.set(CSP_NONCE_HEADER, nonce);
  extraHeaders.set(NEXT_NONCE_HEADER, nonce);

  const response = await updateSession(request, {
    extraHeaders,
  });

  withSecurityHeaders(response, {
    isProduction: process.env.NODE_ENV === "production",
    nonce,
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
