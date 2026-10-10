/**
 * `POST /api/admin/users/[id]/lien-mot-de-passe` — lien de mot de passe d'un
 * compte désigné par son identifiant (fiche d'un compte, page Accès).
 *
 * 401 sans droits, 404 en français sur un compte inconnu ou un identifiant qui
 * n'est pas un UUID, et dans ces trois cas AUCUN lien n'est généré.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const appels: { email: string; redirectTo: string }[] = [];
const lectures: string[] = [];
let admin: { id: string } | null = { id: 'admin' };
let profil: { email: string } | null = null;

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      lectures.push(table);
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) c[m] = () => c;
      c.maybeSingle = async () => ({ data: profil, error: null });
      return c;
    },
    auth: {
      admin: {
        generateLink: async (p: { email: string; options: { redirectTo: string } }) => {
          appels.push({ email: p.email, redirectTo: p.options.redirectTo });
          return { data: { properties: { action_link: 'https://lien.test/secret' } }, error: null };
        },
      },
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => admin,
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

const { POST } = await import('@/app/api/admin/users/[id]/lien-mot-de-passe/route');

const ID = '11111111-1111-4111-8111-111111111111';
const appel = (id = ID) => POST(
  new NextRequest(`http://localhost:3000/api/admin/users/${id}/lien-mot-de-passe`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  appels.length = 0;
  lectures.length = 0;
  admin = { id: 'admin' };
  profil = null;
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
});

describe('POST /api/admin/users/[id]/lien-mot-de-passe', () => {
  it('401 sans droits, sans rien lire ni générer', async () => {
    admin = null;
    const res = await appel();
    expect(res.status).toBe(401);
    expect(lectures).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('404 en français sur un compte inconnu', async () => {
    const res = await appel();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Compte introuvable.' });
    expect(appels).toEqual([]);
  });

  it('404 sur un identifiant qui n est pas un UUID, sans interroger la base', async () => {
    profil = { email: 'ne-doit-pas-servir@exemple.test' };
    const res = await appel('pas-un-uuid');
    expect(res.status).toBe(404);
    expect(lectures).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('rend { lien } pour l email du profil, vers /reset-password', async () => {
    profil = { email: 'compte@exemple.test' };
    const res = await appel();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lien: 'https://lien.test/secret' });
    expect(appels).toEqual([{ email: 'compte@exemple.test', redirectTo: 'http://localhost:3000/reset-password' }]);
  });
});
