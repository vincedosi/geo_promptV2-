/**
 * GENESIS — Shared Supabase client (server-side)
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Variables NEXT_PUBLIC_SUPABASE_URL et SUPABASE_ANON_KEY requises dans .env.local'
    );
  }

  _client = createClient(url, key);
  return _client;
}

// Note: getDbUrl() supprimé en v5.0.0
// L'inserter utilise maintenant le client Supabase JS (HTTPS) au lieu de postgres direct
