import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedPublicClient: SupabaseClient | null = null;

export function supabasePublicServer(): SupabaseClient {
  if (cachedPublicClient) return cachedPublicClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableOrAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableOrAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  cachedPublicClient = createClient(url, publishableOrAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedPublicClient;
}
