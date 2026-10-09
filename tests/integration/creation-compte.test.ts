/**
 * Création d'un compte depuis l'administration, de bout en bout contre la base
 * locale (sql/237).
 *
 * Le 2026-10-09, `POST /api/admin/users` rendait 500 « Utilisateur
 * introuvable » : le déclencheur qui crée le profil manquait en local, et sa
 * fonction posait un espace actif sans appartenance, que sql/236 refuse. Ce
 * fichier passe par la VRAIE route, seule l'identité de l'appelant est simulée.
 *
 * Tout est jetable (`[ESSAI espaces]`, `essai-espaces-…@exemple.test`) et
 * supprimé à la fin. Le lien de première connexion n'est jamais affiché.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
}));

const { POST } = await import('@/app/api/admin/users/route');

const admin = creerClientTest();
const comptes: string[] = [];
let espace: string;

function requete(corps: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI espaces] Création', slug: `essai-espaces-creation-${Date.now()}` })
    .select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  espace = data.id as string;
}, 60_000);

afterAll(async () => {
  for (const id of comptes) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`nettoyage compte ${id} : ${error.message}`);
  }
  const { error } = await admin.from('organizations').delete().eq('id', espace);
  if (error) console.error(`nettoyage espace : ${error.message}`);
}, 60_000);

describe('création de compte (sql/237)', () => {
  it('un compte neuf naît avec un profil client, sans espace actif ni appartenance', async () => {
    const email = `essai-espaces-nu-${Date.now()}@exemple.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`compte : ${error?.message}`);
    comptes.push(data.user.id);

    const { data: profil } = await admin.from('profiles')
      .select('role, organization_id').eq('id', data.user.id).single();
    expect(profil).toEqual({ role: 'client', organization_id: null });
    const { count } = await admin.from('organization_members')
      .select('id', { count: 'exact', head: true }).eq('user_id', data.user.id);
    expect(count).toBe(0);
  });

  it('POST /api/admin/users crée le compte membre de son espace, espace actif posé', async () => {
    const email = `essai-espaces-route-${Date.now()}@exemple.test`;
    const res = await POST(requete({ email, full_name: 'Essai création', role: 'client', organization_id: espace }));
    const corps = await res.json() as { id?: string; setup_link?: string | null; error?: string };
    if (corps.id) comptes.push(corps.id);

    expect(res.status, corps.error).toBe(201);
    expect(typeof corps.setup_link).toBe('string');

    const { data: profil } = await admin.from('profiles')
      .select('role, full_name, organization_id').eq('id', corps.id!).single();
    expect(profil).toEqual({ role: 'client', full_name: 'Essai création', organization_id: espace });
    const { data: membres } = await admin.from('organization_members')
      .select('organization_id').eq('user_id', corps.id!);
    expect(membres).toEqual([{ organization_id: espace }]);
  });

  it('un super_admin créé sans espace n\'est membre de rien', async () => {
    const email = `essai-espaces-sa-${Date.now()}@exemple.test`;
    const res = await POST(requete({ email, role: 'super_admin' }));
    const corps = await res.json() as { id?: string; error?: string };
    if (corps.id) comptes.push(corps.id);

    expect(res.status, corps.error).toBe(201);
    const { data: profil } = await admin.from('profiles')
      .select('role, organization_id').eq('id', corps.id!).single();
    expect(profil).toEqual({ role: 'super_admin', organization_id: null });
  });
});
