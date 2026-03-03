import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthReadyEvent = "INITIAL_SESSION" | "SIGNED_IN" | "TOKEN_REFRESHED";

type AuthenticatedBrowserClientOptions = {
  timeoutMs?: number;
};

const DEFAULT_AUTH_READY_TIMEOUT_MS = 4000;
const AUTH_READY_EVENTS: ReadonlySet<AuthReadyEvent> = new Set([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED",
]);

let browserClient: SupabaseClient | null = null;

function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableOrAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableOrAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createBrowserClient(url, publishableOrAnonKey);
}

export function supabaseBrowser() {
  if (browserClient) return browserClient;
  browserClient = createClient();
  return browserClient;
}

function waitForSessionReady(client: SupabaseClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const finalize = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      subscription?.unsubscribe();
      resolve();
    };

    const timeoutId = globalThis.setTimeout(finalize, timeoutMs);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!AUTH_READY_EVENTS.has(event as AuthReadyEvent)) return;
      if (!session?.user) return;
      finalize();
    });
    subscription = data.subscription;
  });
}

export async function getAuthenticatedBrowserClient(
  options: AuthenticatedBrowserClientOptions = {}
): Promise<SupabaseClient> {
  const client = supabaseBrowser();
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_READY_TIMEOUT_MS;

  const initialSession = await client.auth.getSession();
  if (initialSession.error) {
    throw new Error(initialSession.error.message);
  }
  if (initialSession.data.session?.user) {
    return client;
  }

  // Right after auth transitions, client-side repo reads can race session propagation.
  // Wait for auth-ready events so first navigation does not query as an anonymous user.
  await waitForSessionReady(client, timeoutMs);

  const nextSession = await client.auth.getSession();
  if (nextSession.error) {
    throw new Error(nextSession.error.message);
  }
  if (!nextSession.data.session?.user) {
    throw new Error("Authenticated session is not ready yet. Please retry.");
  }

  return client;
}
