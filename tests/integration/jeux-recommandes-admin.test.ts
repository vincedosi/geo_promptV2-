/**
 * GET / PUT /api/admin/espaces/[id]/jeux-recommandes contre la vraie base locale (spec carte-en-parcours § 7.2).
 * Seule l'identité de l'appelant est simulée. Un espace `[ESSAI parcours]` est créé puis supprimé (la sélection part
 * avec lui : ON DELETE CASCADE).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

let admin = true;
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => (admin
    ? { id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }
    : null),
}));

const { GET, PUT } = await import('@/app/api/admin/espaces/[id]/jeux-recommandes/route');
const sb = creerClientTest();

let espace = '';
const INEXISTANT = '00000000-0000-4000-8000-00000000dead';

function url(id: string) { return `http://localhost:3000/api/admin/espaces/${id}/jeux-recommandes`; }
function lire(id: string) {
  return GET(new NextRequest(url(id)), { params: Promise.resolve({ id }) });
}
function ecrire(id: string, corps: string) {
  return PUT(new NextRequest(url(id), { method: 'PUT', body: corps, headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id }) });
}
async function enBase(): Promise<string[]> {
  const { data, error } = await sb.from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', espace).order('cle_jeu');
  if (error) throw new Error(error.message);
  return (data ?? []).map((l: { cle_jeu: string }) => l.cle_jeu);
}

beforeAll(async () => {
  const { data, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI parcours] Jeux recommandés', slug: `essai-parcours-jeux-${Date.now()}` })
    .select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  espace = data.id as string;
});

afterAll(async () => {
  if (!espace) return;
  const { error } = await sb.from('organizations').delete().eq('id', espace);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('sélection recommandée d un espace (admin)', () => {
  it('PUT remplace la sélection, GET la rend cochée', async () => {
    const res = await ecrire(espace, JSON.stringify({ cles: ['poi:lycee', 'iris:socio-demo'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cles: ['iris:socio-demo', 'poi:lycee'] });

    const lu = await lire(espace);
    expect(lu.status).toBe(200);
    const { jeux, socleIncomplet } = (await lu.json()) as { jeux: { cle: string; recommande: boolean }[]; socleIncomplet: boolean };
    expect(socleIncomplet).toBe(false);
    expect(jeux.filter((j) => j.recommande).map((j) => j.cle).sort()).toEqual(['iris:socio-demo', 'poi:lycee']);
    expect(jeux.length).toBeGreaterThan(10);
  });

  it('clé inconnue du registre : 400, sélection inchangée', async () => {
    const res = await ecrire(espace, JSON.stringify({ cles: ['iris:inconnu'] }));
    expect(res.status).toBe(400);
    expect(await enBase()).toEqual(['iris:socio-demo', 'poi:lycee']);
  });

  it('type de POI absent des données communes : 400 qui le nomme, sélection inchangée', async () => {
    const res = await ecrire(espace, JSON.stringify({ cles: ['poi:lycee', 'poi:nexiste_pas'] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('poi:nexiste_pas');
    expect(await enBase()).toEqual(['iris:socio-demo', 'poi:lycee']);
  });

  it('corps illisible : 400', async () => {
    expect((await ecrire(espace, '{pas du json')).status).toBe(400);
  });

  it('espace inexistant : 404 en lecture et en écriture', async () => {
    expect((await lire(INEXISTANT)).status).toBe(404);
    expect((await ecrire(INEXISTANT, JSON.stringify({ cles: [] }))).status).toBe(404);
  });

  it('liste vide : vide la sélection', async () => {
    const res = await ecrire(espace, JSON.stringify({ cles: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cles: [] });
    expect(await enBase()).toEqual([]);
  });

  it('non super_admin : refusé en lecture et en écriture', async () => {
    admin = false;
    try {
      expect((await lire(espace)).status).toBe(403);
      expect((await ecrire(espace, JSON.stringify({ cles: ['iris:socio-demo'] }))).status).toBe(403);
      expect(await enBase()).toEqual([]);
    } finally {
      admin = true;
    }
  });
});
