/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';


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
