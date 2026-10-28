/**
 * Fiche d'un jeu de la carte et groupes d'espaces (lot « Catalogue et groupes », T3 ; sql/289) — contre la vraie base
 * locale. Seule l'identité de l'appelant est simulée. Un espace `[ESSAI catalogue]` est créé puis supprimé.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

let qui: { id: string; organization_id: string } | null = null;
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
  requireAuth: async () => (qui ? { ...qui, role: 'client', email: 'essai@fiche.test', full_name: null } : null),
}));
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => (qui ? { userId: qui.id, orgId: qui.organization_id, role: 'client' } : null),
}));

const { GET: lireEspaces } = await import('@/app/api/admin/espaces/route');
const { PATCH: modifier } = await import('@/app/api/admin/organizations/[id]/route');
const { GET: fiche } = await import('@/app/api/map/catalogue/fiche/route');
const sb = creerClientTest();

let espace = '';

async function groupeLu(): Promise<string | null | undefined> {
  const res = await lireEspaces(new NextRequest('http://localhost:3000/api/admin/espaces'));
  expect(res.status).toBe(200);
  const { espaces } = (await res.json()) as { espaces: { id: string; groupe_espace: string | null }[] };
  return espaces.find((e) => e.id === espace)?.groupe_espace;
}

function poser(groupe: unknown) {
  return modifier(new NextRequest(`http://localhost:3000/api/admin/organizations/${espace}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groupe_espace: groupe }),
  }), { params: Promise.resolve({ id: espace }) });
}

function lireFiche(cle: string) {
  return fiche(new NextRequest(`http://localhost:3000/api/map/catalogue/fiche?cle=${encodeURIComponent(cle)}`));
}

beforeAll(async () => {
  const { data, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI catalogue] Groupes', slug: `essai-catalogue-groupes-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  espace = data.id as string;
});

afterAll(async () => {
  qui = null;
  if (!espace) return;
  const { error } = await sb.from('organizations').delete().eq('id', espace);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('groupe d espaces (A-9)', () => {
  it('PATCH « Armées » (rogné) → GET admin/espaces le rend ; null l efface', async () => {
    expect(await groupeLu()).toBeNull();
    expect((await poser('  Armées ')).status).toBe(200);
    expect(await groupeLu()).toBe('Armées');
    expect((await poser(null)).status).toBe(200);
    expect(await groupeLu()).toBeNull();
  });

  it('61 caractères, ou vide une fois rogné : 400, rien d écrit', async () => {
    expect((await poser('Armées')).status).toBe(200);
    expect((await poser('x'.repeat(61))).status).toBe(400);
    expect((await poser('   ')).status).toBe(400);
    expect(await groupeLu()).toBe('Armées');
    expect((await poser('x'.repeat(60))).status).toBe(200);
  });
});

describe('fiche d un jeu (A-8)', () => {
  it('sans session : 401', async () => {
    qui = null;
    expect((await lireFiche('poi:lycee')).status).toBe(401);
  });

  it('type de POI du socle : sa source, son effectif valid_count, niveau socle', async () => {
    qui = { id: '00000000-0000-4000-8000-0000000f1c11', organization_id: espace };
    const res = await lireFiche('poi:lycee');
    expect(res.status).toBe(200);
    const { data: src, error } = await sb.from('data_sources').select('name, valid_count')
      .eq('type', 'poi').eq('category', 'lycee').eq('visibilite', 'socle');
    expect(error).toBeNull();
    const corps = (await res.json()) as { referentiel: boolean; sources: { nom: string; niveau: string; effectif: number }[] };
    expect(corps.referentiel).toBe(false);
    expect(corps.sources.map((s) => [s.nom, s.niveau, s.effectif]))
      .toEqual((src ?? []).map((s) => [s.name, 'socle', s.valid_count]));
  });

  it('type de POI privé à un autre espace, clé inconnue : 404, indiscernables', async () => {
    qui = { id: '00000000-0000-4000-8000-0000000f1c11', organization_id: espace };
    const prive = await lireFiche('poi:bmw');
    const inconnu = await lireFiche('iris:inconnu');
    expect(prive.status).toBe(404);
    expect(await prive.json()).toEqual(await inconnu.json());
  });

  it('référentiel lié à l abstention (au socle) : « référentiel système » et sa source de 6 186 CP', async () => {
    qui = { id: '00000000-0000-4000-8000-0000000f1c11', organization_id: espace };
    const res = await lireFiche('civique:indicateurs-cp');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      referentiel: true, sources: [{ niveau: 'socle', effectif: 6186, proprietaire: 'dentsu.explore (interne)' }],
    });
  });
});
