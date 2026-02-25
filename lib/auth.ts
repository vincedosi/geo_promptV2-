/**
 * GENESIS — Auth helpers (server-side)
 * Supabase Auth integration
 */
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

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
 * Create a Supabase admin client (bypasses RLS)
 * Uses service_role key for admin operations
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fallback to anon key if service role not configured
  const key = serviceKey || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
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
    organization_name: (profile as any).organizations?.name,
  };
}

/**
 * Check if user is super_admin
 */
export function isSuperAdmin(profile: UserProfile | null): boolean {
  return profile?.role === 'super_admin';
}
