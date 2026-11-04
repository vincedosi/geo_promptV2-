import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/dev/connexion-auto — connexion automatique du lancement Angular
 * AUTONOME, en développement local SEULEMENT (décision du 2026-11-02 : plus
 * d'écran de connexion en local ; dans AIDA, rien ne change).
 *
 * - Hors `next dev` (`NODE_ENV !== 'development'`) : 404, la route n'existe pas.
 * - Sans `DEV_CONNEXION_AUTO_EMAIL` ou `DEV_CONNEXION_AUTO_MOT_DE_PASSE` : 404.
 *   Ces deux variables vivent dans `.env.development.local`, NON suivi par git
 *   — jamais dans un fichier versionné (`aucun-secret-en-dur.test.ts`).
 * - Sinon : ouvre une session Supabase côté serveur (clé anon) et rend `{ access_token, refresh_token }`.
 *   L'Angular les pose dans son client (`setSession`), qui écrit le cookie
 *   `@supabase/ssr`.
 *
 * Les identifiants ne quittent jamais le serveur. Un 404 ou un échec laisse
 * l'Angular sur un message en place (vérifier `DEV_CONNEXION_AUTO_*`) : il
 * n'y a plus de page de connexion (supprimée le 2026-11-05, AIDA gère la
 * session), cette route est le SEUL moyen d'ouvrir l'app en local hors AIDA.
 *
 * Hors du matcher de `middleware.ts` (fichier protégé) : aucune session n'est
 * exigée, c'est précisément ce qu'elle ouvre.
 */
export async function POST() {
  if (process.env.NODE_ENV !== 'development') return introuvable();

  const email = process.env.DEV_CONNEXION_AUTO_EMAIL?.trim();
  const motDePasse = process.env.DEV_CONNEXION_AUTO_MOT_DE_PASSE;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!email || !motDePasse || !url || !cleAnon) return introuvable();

  const supabase = createClient(url, cleAnon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error || !data.session) {
    // Le message de GoTrue ne porte pas les identifiants ; on ne les journalise pas non plus.
    console.warn('[dev/connexion-auto] connexion refusée :', error?.message ?? 'aucune session');
    return NextResponse.json(
      { error: 'Connexion automatique refusée — vérifier DEV_CONNEXION_AUTO_* dans .env.development.local.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function introuvable() {
  return NextResponse.json({ error: 'Introuvable.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
