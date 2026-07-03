/**
 * GENESIS — Auth helpers (server-side)
 * Supabase Auth integration
 */
import { createClient } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'super_admin' | 'admin' | 'client';
  organization_id: string | null;
  organization_name?: string;
}

/**
 * Create a Supabase client with the user's session cookie
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey);
}

/**
 * Create a Supabase admin client (bypasses RLS).
 * Uses the service_role key — obligatoire pour les opérations admin.
 *
 * ⚠️  Lance une erreur explicite si SUPABASE_SERVICE_ROLE_KEY est absent,
 *     plutôt que de retomber silencieusement sur la clé anon (qui respecte
 *     les RLS et ferait échouer toutes les opérations admin de façon opaque).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('[auth] NEXT_PUBLIC_SUPABASE_URL manquante — impossible de créer le client admin.');
  }
  if (!serviceKey || serviceKey === 'A_REMPLACER') {
    throw new Error(
      '[auth] SUPABASE_SERVICE_ROLE_KEY manquante ou non configurée. ' +
      'Ajoutez-la dans .env.local (Settings > API > service_role dans Supabase).'
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Next.js patche `fetch` et applique son Data Cache aux appels sortants.
    // Sans cette surcharge, supabase-js retourne des `profiles.organization_id`
    // périmés après un UPDATE (bug switch-org : la POST écrit en DB mais
    // les GET suivants relisent la version cachée). On force `no-store`.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

/**
 * Get current user profile from a request's auth header
 * Returns null if not authenticated
 */
export async function getUserFromRequest(authHeader: string | null): Promise<UserProfile | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const supabase = createAdminClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organizations(name)')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    organization_id: profile.organization_id,
    organization_name: (profile as { organizations?: { name?: string } }).organizations?.name,
  };
}

/**
 * Check if user is super_admin
 */
export function isSuperAdmin(profile: UserProfile | null): boolean {
  return profile?.role === 'super_admin';
}
