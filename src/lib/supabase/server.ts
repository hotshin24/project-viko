import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/** RSC reads only; Route Handlers explicitly opt into cookie writes. */
export async function serverSupabase(writable = false) {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        if (writable)
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
      },
    },
  });
}

export async function verifiedEmail() {
  const client = await serverSupabase();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getUser();
    return !error && data.user ? (data.user.email ?? null) : null;
  } catch {
    return null;
  }
}
