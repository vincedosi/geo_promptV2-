/**
 * Vue « Tous les comptes » de la page Accès, contre la base locale :
 * `GET /api/admin/espaces/comptes` et le compteur `nb_comptes` de
 * `GET /api/admin/espaces`.
 *
 * Passe par les VRAIES routes, seule l'identité de l'appelant est simulée. On
 * vérifie des RELATIONS (le compte jetable est là, avec ses espaces), pas des
 * effectifs figés : d'autres fichiers créent et suppriment des comptes en
 * parallèle. Tout est jetable (`[ESSAI comptes]`, `essai-comptes-…@exemple.test`)
 * et supprimé à la fin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import type { ReponseComptes, ReponseEspaces } from '@/lib/espaces/types';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
}));

const { GET } = await import('@/app/api/admin/espaces/comptes/route');
const { GET: GET_ESPACES } = await import('@/app/api/admin/espaces/route');

const admin = creerClientTest();
const comptes: string[] = [];
const espaces: string[] = [];
let membre: string;
let sansEspace: string;

function requete(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`);
}

async function creerCompte(cle: string): Promise<string> {
  const email = `essai-comptes-${cle}-${Date.now()}@exemple.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`compte ${cle} : ${error?.message}`);
  comptes.push(data.user.id);
  return data.user.id;
}

beforeAll(async () => {
  for (const n of ['B', 'A']) {
    const { data, error } = await admin.from('organizations')
      .insert({ name: `[ESSAI comptes] ${n}`, slug: `essai-comptes-${n.toLowerCase()}-${Date.now()}` })
      .select('id').single();
    if (error || !data) throw new Error(`espace ${n} : ${error?.message}`);
    espaces.push(data.id as string);
  }
  // Un membre de DEUX espaces, actif sur le premier ; un compte rattaché à rien.
  membre = await creerCompte('membre');
  for (const org of espaces) {
    const m = await admin.from('organization_members').insert({ user_id: membre, organization_id: org });
    if (m.error) throw new Error(`appartenance : ${m.error.message}`);
  }
  const p = await admin.from('profiles').update({ organization_id: espaces[0], full_name: '[ESSAI comptes] Membre' }).eq('id', membre);
  if (p.error) throw new Error(`profil : ${p.error.message}`);
  sansEspace = await creerCompte('nu');
}, 60_000);

afterAll(async () => {
  for (const id of comptes) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`nettoyage compte ${id} : ${error.message}`);
  }
  for (const id of espaces) {
    const { error } = await admin.from('organizations').delete().eq('id', id);
    if (error) console.error(`nettoyage espace ${id} : ${error.message}`);
  }
}, 60_000);

describe('GET /api/admin/espaces/comptes', () => {
  it('rend TOUS les profils, le compte sans espace compris', async () => {
    const res = await GET(requete('/api/admin/espaces/comptes'));
    expect(res.status).toBe(200);
    const { comptes: liste } = await res.json() as ReponseComptes;
    const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    expect(liste).toHaveLength(count!);
    const nu = liste.find((c) => c.id === sansEspace)!;
    expect(nu).toMatchObject({ role: 'client', espace_actif: null, espaces: [], nom: null });
    expect(typeof nu.cree_le).toBe('string');
    expect(Number.isNaN(Date.parse(nu.cree_le ?? ''))).toBe(false);
  });

  it('chaque compte porte TOUS ses espaces (nom affiché, ordre alphabétique) et son espace actif', async () => {
    const { comptes: liste } = await (await GET(requete('/api/admin/espaces/comptes'))).json() as ReponseComptes;
    const m = liste.find((c) => c.id === membre)!;
    expect(m.nom).toBe('[ESSAI comptes] Membre');
    expect(m.espace_actif).toBe(espaces[0]);
    expect(m.espaces).toEqual([
      { id: espaces[1], nom_affiche: '[ESSAI comptes] A' },
      { id: espaces[0], nom_affiche: '[ESSAI comptes] B' },
    ]);
  });

  it('l\'espace interne est rendu sous son nom affiché (E2), jamais « GENESIS »', async () => {
    const { comptes: liste } = await (await GET(requete('/api/admin/espaces/comptes'))).json() as ReponseComptes;
    const noms = liste.flatMap((c) => c.espaces.map((e) => e.nom_affiche));
    expect(noms.some((n) => /GENESIS/.test(n))).toBe(false);
  });

  it('triés par email', async () => {
    const { comptes: liste } = await (await GET(requete('/api/admin/espaces/comptes'))).json() as ReponseComptes;
    const emails = liste.map((c) => c.email);
    expect(emails).toEqual([...emails].sort((a, b) => a.localeCompare(b, 'fr')));
  });
});

describe('GET /api/admin/espaces — nb_comptes', () => {
  it('compte tous les profils', async () => {
    const res = await GET_ESPACES(requete('/api/admin/espaces'));
    expect(res.status).toBe(200);
    const corps = await res.json() as ReponseEspaces;
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    expect(corps.nb_comptes).toBe(count);
  });
});
