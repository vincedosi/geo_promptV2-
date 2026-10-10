/**
 * Lien de mot de passe par identifiant de compte, contre la base locale :
 * `POST /api/admin/users/[id]/lien-mot-de-passe`.
 *
 * Vérifie aussi la DESTINATION du lien, ce que les tests unitaires ne peuvent
 * pas voir : GoTrue remplace en silence un `redirectTo` absent de sa liste
 * blanche par `site_url`. Le 2026-10-10, le lien local portait
 * `redirect_to=http://127.0.0.1:3000` (la racine) — `supabase/config.toml`
 * n'autorisait que `https://127.0.0.1:3000`. Si ce test échoue sur
 * `redirect_to`, la liste blanche de l'auth locale a dérivé.
 *
 * Le lien lui-même n'est jamais affiché. Compte jetable supprimé à la fin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
}));

const { POST } = await import('@/app/api/admin/users/[id]/lien-mot-de-passe/route');

const admin = creerClientTest();
let compte: string | null = null;

const appel = (id: string) => POST(
  new NextRequest(`http://localhost:3000/api/admin/users/${id}/lien-mot-de-passe`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  const email = `essai-lien-${Date.now()}@exemple.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`compte : ${error?.message}`);
  compte = data.user.id;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!compte) return;
  const { error } = await admin.auth.admin.deleteUser(compte);
  if (error) console.error(`nettoyage compte ${compte} : ${error.message}`);
}, 60_000);

describe('POST /api/admin/users/[id]/lien-mot-de-passe', () => {
  it('rend un lien qui mène à /reset-password de l origine de la requête', async () => {
    const res = await appel(compte!);
    const corps = await res.json() as { lien?: string; error?: string };
    expect(res.status, corps.error).toBe(200);
    expect(typeof corps.lien).toBe('string');
    expect(new URL(corps.lien!).searchParams.get('redirect_to')).toBe('http://localhost:3000/reset-password');
  });

  it('404 en français pour un compte qui n existe pas', async () => {
    const res = await appel('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Compte introuvable.' });
  });
});
