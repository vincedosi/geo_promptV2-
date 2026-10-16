import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `getSessionOrg` doit lire le cookie que le NAVIGATEUR écrit vraiment.
 *
 * ── Le défaut verrouillé ici (2026-10-08) ──────────────────────────────────
 *
 * `@supabase/ssr` 0.5.x écrit son cookie de session en `base64-<base64url>`
 * par défaut (`createBrowserClient`, `cookieEncoding: "base64url"`). Le
 * lecteur ne connaissait que le JSON brut : `JSON.parse` échouait, la session
 * était déclarée absente — sans erreur.
 *
 * Toute route appelée par un `fetch` nu (sans en-tête Authorization) voyait
 * donc « pas de session ». Tant que la règle d'autorisation OUVRAIT sans
 * session, `/api/map/pois` servait les POI de toutes les organisations à
 * tout client connecté. Une fois la règle fermée par défaut, le même défaut
 * réduisait le super_admin au socle. Les deux symptômes ont la même cause.
 */

const getUser = vi.fn();
const profil = { data: { organization_id: 'org-1' as string | null, role: 'super_admin' }, error: null };

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => profil }) }) }),
  }),
}));

const { getSessionOrg, orgIdActif, orgIdDeSession } = await import('@/lib/auth/getSessionOrg');

const URL_LOCALE = 'http://127.0.0.1:54321';
const NOM = 'sb-127-auth-token';
const jeton = { access_token: 'jeton-de-test', refresh_token: 'r' };

function requete(cookies: Record<string, string>): NextRequest {
  const entete = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest('http://localhost:3000/api/x', { headers: { cookie: entete } });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_LOCALE;
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
});

describe('getSessionOrg — formats de cookie', () => {
  it('lit le format base64 de @supabase/ssr (celui du navigateur)', async () => {
    const valeur = 'base64-' + Buffer.from(JSON.stringify(jeton)).toString('base64url');
    const s = await getSessionOrg(requete({ [NOM]: valeur }));
    expect(getUser).toHaveBeenCalledWith('jeton-de-test');
    expect(s?.role).toBe('super_admin');
  });

  it('lit le format base64 découpé en morceaux (.0, .1)', async () => {
    const valeur = 'base64-' + Buffer.from(JSON.stringify(jeton)).toString('base64url');
    const milieu = Math.floor(valeur.length / 2);
    const s = await getSessionOrg(requete({ [`${NOM}.0`]: valeur.slice(0, milieu), [`${NOM}.1`]: valeur.slice(milieu) }));
    expect(getUser).toHaveBeenCalledWith('jeton-de-test');
    expect(s).not.toBeNull();
  });

  it('lit toujours le JSON brut (ancien format)', async () => {
    const s = await getSessionOrg(requete({ [NOM]: encodeURIComponent(JSON.stringify(jeton)) }));
    expect(getUser).toHaveBeenCalledWith('jeton-de-test');
    expect(s).not.toBeNull();
  });

  it('un cookie illisible donne null, sans lever', async () => {
    expect(await getSessionOrg(requete({ [NOM]: 'base64-%%%pas-du-base64' }))).toBeNull();
  });
});

describe('orgIdActif — l espace actif d une requête', () => {
  const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const cookie = () => requete({ [NOM]: 'base64-' + Buffer.from(JSON.stringify(jeton)).toString('base64url') });

  it('l organisation de la session si c est un UUID', async () => {
    profil.data.organization_id = ORG;
    expect(await orgIdActif(cookie())).toBe(ORG);
  });

  it('null pour un espace qui n est pas un UUID, sans espace, ou sans session', async () => {
    profil.data.organization_id = 'org-1';
    expect(await orgIdActif(cookie())).toBeNull();
    profil.data.organization_id = null;
    expect(await orgIdActif(cookie())).toBeNull();
    expect(await orgIdActif(requete({}))).toBeNull();
    expect(orgIdDeSession(null)).toBeNull();
    profil.data.organization_id = 'org-1';
  });
});
