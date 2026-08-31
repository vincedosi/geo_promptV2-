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
import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

function getSupabaseBrowserClient() {
  if (!_client) {
    _client = createBrowserClient(
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
 *
 * À utiliser pour TOUTE route API protégée par un guard serveur
 * (`requireAuth` / `requireAdmin` / `requireDspAccess`), qu'elle soit
 * sous /api/admin ou non : les guards lisent le header Authorization et
 * n'ont aucun fallback cookie. Un `fetch()` nu sur une route gardée
 * renvoie donc systématiquement 401.
 */
export async function authFetch(
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

/**
 * Alias historique de `authFetch`, conservé pour les ~89 call sites
 * existants sous /api/admin. Les nouveaux appels utilisent `authFetch`.
 */
export const adminFetch = authFetch;
