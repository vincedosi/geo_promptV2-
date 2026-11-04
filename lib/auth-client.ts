"use client";

/**
 * MAGELIAN — helpers d'authentification cote CLIENT.
 *
 * Expose un client Supabase navigateur en singleton (les cookies HttpOnly
 * sont geres par @supabase/ssr) et deux hooks React : useSession et
 * useSignOut. Aucun hook de connexion : la page de connexion a ete supprimee
 * le 2026-11-05, la session est ouverte par le shell AIDA (ou, en
 * developpement local, par `POST /api/dev/connexion-auto`).
 *
 * A ne jamais importer cote serveur : utiliser `@/lib/auth` pour cela.
 */
import { createBrowserClient } from "@supabase/ssr";
import { useState, useEffect, useCallback } from "react";

// ---------- Supabase browser client (singleton) ----------
// createBrowserClient gère les cookies automatiquement (HttpOnly via SSR)
let _browser: ReturnType<typeof createBrowserClient> | null = null;

function getBrowserClient() {
  if (!_browser) {
    _browser = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _browser;
}

// ---------- Types ----------
interface Session {
  id: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string | null;
    emailVerified: boolean;
    organizationId: string | null;
  };
  expiresAt: string;
}

// ---------- buildSession (sync, métadonnées immédiates) ----------
// Construit la session avec les infos disponibles dans le JWT (email, metadata).
// Le profil DB (role, organization_id) est enrichi APRÈS via fetchProfileEnrichment
// pour éviter de bloquer l'affichage de l'email pendant la requête profiles.
type SupaSessionLite = {
  access_token: string;
  expires_at?: number | null;
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null; email_confirmed_at?: string | null };
};

function buildSession(supaSession: SupaSessionLite): Session {
  const u = supaSession.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null;
  const metaRole = (meta.role as string | undefined) ?? null;
  const metaOrg = (meta.organization_id as string | undefined) ?? null;

  return {
    id: supaSession.access_token,
    user: {
      id: u.id,
      email: u.email ?? "",
      name: metaName,
      role: metaRole ?? "user",
      emailVerified: !!u.email_confirmed_at,
      organizationId: metaOrg,
    },
    expiresAt: supaSession.expires_at
      ? new Date(supaSession.expires_at * 1000).toISOString()
      : new Date(Date.now() + 3600_000).toISOString(),
  };
}

// Enrichit la session avec les données DB (role, organization_id, full_name).
// RLS profiles_select autorise (id = auth.uid()). Si la requête échoue ou est
// lente, on garde simplement les valeurs du JWT — l'UI ne reste jamais bloquée.
async function fetchProfileEnrichment(userId: string): Promise<Partial<Session['user']> | null> {
  try {
    const sb = getBrowserClient();
    const { data: profile, error } = await sb
      .from('profiles')
      .select('role, organization_id, full_name')
      .eq('id', userId)
      .single();
    if (error) {
      console.warn('[useSession] profiles fetch error', error);
      return null;
    }
    if (!profile) return null;
    const p = profile as { role?: string | null; organization_id?: string | null; full_name?: string | null };
    return {
      role: p.role ?? undefined,
      organizationId: p.organization_id ?? undefined,
      name: p.full_name ?? undefined,
    };
  } catch (e) {
    console.warn('[useSession] profiles fetch exception', e);
    return null;
  }
}

// ---------- useSession ----------
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sb = getBrowserClient();
    let cancelled = false;

    // Helper : pose la session immédiatement (email visible) puis enrichit
    // le profil DB (role, org) en background. Ne bloque jamais isLoading
    // sur la requête profiles — sinon le badge user reste sur "..." si la
    // DB est lente ou si profiles_select fail.
    const applySession = (supaSession: SupaSessionLite) => {
      const base = buildSession(supaSession);
      if (!cancelled) {
        setSession(base);
        setIsLoading(false);
      }
      void fetchProfileEnrichment(supaSession.user.id).then(enrich => {
        if (cancelled || !enrich) return;
        setSession(prev => prev ? { ...prev, user: { ...prev.user, ...enrich } } : prev);
      });
    };

    // Initial check
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        applySession(data.session);
      } else if (!cancelled) {
        setIsLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, supaSession) => {
      if (supaSession?.user) {
        applySession(supaSession);
      } else if (!cancelled) {
        setSession(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}

// ---------- useSignOut ----------
// Plus de page de connexion vers laquelle partir (2026-11-05) : on recharge la
// carte, et le middleware repond « Session absente » (401) — la reconnexion
// passe par AIDA.
export function useSignOut() {
  const signOut = useCallback(async () => {
    const sb = getBrowserClient();
    await sb.auth.signOut();
    window.location.href = "/map";
  }, []);

  return { signOut };
}
