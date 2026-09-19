/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';


export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Only construct the client when real credentials exist — no placeholder URL.
export const supabase = isSupabaseConfigured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string
    )
  : null;

/**
 * The client, or null. Consumers narrow on THIS rather than pairing `isSupabaseConfigured` with a
 * nullable `supabase`: a boolean flag and a separate object give the compiler nothing to check, which
 * is how `handleLogout` ended up dereferencing a possibly-null client "because a session implies the
 * client exists" - true today by luck, and true only transitively.
 */
export function requireSupabaseClient(): SupabaseClient | null {
  return supabase;
}
