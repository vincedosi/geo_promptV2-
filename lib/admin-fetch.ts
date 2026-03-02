"use client";

/**
 * GENESIS — Client-side admin fetch helper
 *
 * Wrapper autour de `fetch` qui injecte automatiquement le Bearer token
 * de la session Supabase courante dans les requêtes vers /api/admin/*.
 *
 * Usage :
 *   import { adminFetch } from '@/lib/admin-fetch';
 *   const res = await adminFetch('/api/admin/sources');
 */
import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | null = null;

function getSupabaseBrowserClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

/**
 * Récupère le token d'accès de la session Supabase courante.
 * Retourne null si l'utilisateur n'est pas connecté.
 */
async function getAccessToken(): Promise<string | null> {
  const sb = getSupabaseBrowserClient();
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * fetch() enrichi du header Authorization: Bearer <token>.
 * Signature identique à fetch() standard — drop-in replacement.
 */
export async function adminFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Préserver le Content-Type si déjà positionné (ex: multipart/form-data)
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}
