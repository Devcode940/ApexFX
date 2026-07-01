/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';


// Supabase configuration for zrqscleekkenxfnrxvzg.supabase.co
// For client-side: Use VITE_ prefixed variables (available in browser via import.meta.env)
// For server-side: Uses process.env variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 
  process.env.SUPABASE_URL || 
  'https://zrqscleekkenxfnrxvzg.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 
  process.env.SUPABASE_KEY || 
  'placeholder';


export const isSupabaseConfigured = Boolean(
  (import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) && 
  (import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
