/**
 * `middleware.ts` sans session — il n'y a plus de page de connexion
 * (décision du propriétaire, 2026-11-05 : « c'est AIDA qui va gérer ça »).
 *
 * - Une PAGE protégée sans session répond 401 en texte français, sans
 *   redirection : `/login` n'existe plus, y renvoyer rendrait un 404.
 * - Une route API protégée garde son comportement : `getSession()` (jamais
 *   `getUser()`, incident du 28/03) et 401 JSON.
 * - Avec une session, rien ne change : la requête passe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let utilisateur: { id: string } | null = null;
let session: { user: { id: string } } | null = null;
const appels = { getUser: 0, getSession: 0 };

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => { appels.getUser++; return { data: { user: utilisateur } }; },
      getSession: async () => { appels.getSession++; return { data: { session } }; },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { middleware } = await import('@/middleware');

const requete = (chemin: string) => new NextRequest(new URL(chemin, 'http://localhost:3000'));

beforeEach(() => {
  utilisateur = null;
  session = null;
  appels.getUser = 0;
  appels.getSession = 0;
});

describe('middleware — page protégée sans session', () => {
  it.each(['/map', '/dashboard', '/admin/acces', '/demo'])('%s : 401 texte, aucune redirection', async (chemin) => {
    const r = await middleware(requete(chemin));
    expect(r.status).toBe(401);
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-type')).toContain('text/plain');
    const texte = await r.text();
    expect(texte).toBe(
      "Session absente : la connexion est gérée par AIDA. En développement local, lancez l'app avec la connexion automatique.",
    );
    expect(texte).not.toMatch(/login/i);
    expect(appels.getUser).toBe(1);
  });

  it('avec une session, la page passe', async () => {
    utilisateur = { id: 'u1' };
    const r = await middleware(requete('/map'));
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
  });
});

describe('middleware — routes API inchangées', () => {
  it('API protégée sans session : 401 JSON par getSession, jamais getUser', async () => {
    const r = await middleware(requete('/api/admin/users'));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Non authentifié — fournissez un token Bearer valide.' });
    expect(appels.getSession).toBe(1);
    expect(appels.getUser).toBe(0);
  });

  it('API protégée avec session : passe', async () => {
    session = { user: { id: 'u1' } };
    const r = await middleware(requete('/api/admin/users'));
    expect(r.status).toBe(200);
    expect(appels.getUser).toBe(0);
  });
});

describe('middleware — plus aucune trace de page de connexion', () => {
  it("le source ne cite plus /login ni de paramètre de reprise", async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('middleware.ts', 'utf-8');
    expect(source).not.toMatch(/['"`]\/login/);
    expect(source).not.toMatch(/searchParams\.set\(\s*'redirect'/);
    expect(source).not.toMatch(/NextResponse\.redirect/);
  });
});
