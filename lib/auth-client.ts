"use client";

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

// ---------- useSession ----------
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sb = getBrowserClient();

    // Initial check
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        const u = data.session.user;
        setSession({
          id: data.session.access_token,
          user: {
            id: u.id,
            email: u.email ?? "",
            name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
            role: u.user_metadata?.role ?? u.role ?? "user",
            emailVerified: !!u.email_confirmed_at,
            organizationId: u.user_metadata?.organization_id ?? null,
          },
          expiresAt: data.session.expires_at
            ? new Date(data.session.expires_at * 1000).toISOString()
            : new Date(Date.now() + 3600_000).toISOString(),
        });
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, supaSession) => {
      if (supaSession?.user) {
        const u = supaSession.user;
        setSession({
          id: supaSession.access_token,
          user: {
            id: u.id,
            email: u.email ?? "",
            name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
            role: u.user_metadata?.role ?? u.role ?? "user",
            emailVerified: !!u.email_confirmed_at,
            organizationId: u.user_metadata?.organization_id ?? null,
          },
          expiresAt: supaSession.expires_at
            ? new Date(supaSession.expires_at * 1000).toISOString()
            : new Date(Date.now() + 3600_000).toISOString(),
        });
      } else {
        setSession(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, isLoading };
}

// ---------- useSignIn ----------
export function useSignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signIn = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const sb = getBrowserClient();
      const { error: sbError } = await sb.auth.signInWithPassword({ email, password });
      if (sbError) throw new Error(sbError.message);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') ?? '';
      // Prevent open redirect: only allow same-origin relative paths
      const safeRedirect = /^\/[^/\\]/.test(redirect) ? redirect : '/map';
      window.location.href = safeRedirect;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { signIn, isLoading, error };
}

// ---------- useSignUp ----------
export function useSignUp() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const sb = getBrowserClient();
      const { error: sbError } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || email.split("@")[0] } },
      });
      if (sbError) throw new Error(sbError.message);
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { signUp, isLoading, error };
}

// ---------- useSignOut ----------
export function useSignOut() {
  const signOut = useCallback(async () => {
    const sb = getBrowserClient();
    await sb.auth.signOut();
    window.location.href = "/login";
  }, []);

  return { signOut };
}
