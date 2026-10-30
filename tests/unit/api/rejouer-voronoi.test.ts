/**
 * `POST /api/analyses/[id]/rejouer` après la suppression du Voronoï (30/10/2026, décision Vincent) : une analyse
 * enregistrée de type `voronoi` répond un refus propre (410 `outil_supprime`, une phrase), sans moteur ; les autres types
 * gardent leur réponse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { etat, reinitialiser, ORG } from './_doublures-route';

vi.mock('@/lib/api/middleware', async () => ({
  ...(await import('./_doublures-route')),
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Non authentifié.' }), { status: 401 }),
}));
vi.mock('@/lib/auth', () => import('./_doublures-route'));

const { POST } = await import('@/app/api/analyses/[id]/rejouer/route');
const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3399';

function rejouer() {
  return POST(new NextRequest(`http://localhost/api/analyses/${ID}/rejouer`, { method: 'POST' }), { params: Promise.resolve({ id: ID }) });
}

const ligne = (type: string) => ({ data: { type, nom: 'A', parametres: {}, maillage: 'cp', perimetre: null }, error: null });

beforeEach(() => reinitialiser());

describe('rejouer une analyse Voronoï supprimée', () => {
  it('410 outil_supprime, avec la phrase, et la lecture bornée à l’espace', async () => {
    etat.tables.analyses = ligne('voronoi');
    const r = await rejouer();
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({
      error: 'Le Voronoï a été supprimé le 30/10/2026 : cette analyse se consulte mais ne se rejoue plus.',
      refus: 'outil_supprime',
    });
    expect(etat.lectures[0].filtres).toContainEqual(['eq', 'org_id', ORG]);
  });

  it('un score se rejoue toujours (moteur câblé)', async () => {
    etat.tables.analyses = ligne('score');
    const r = await rejouer();
    expect(r.status).toBe(200);
    expect((await r.json()).moteur).toEqual({ cable: true, endpoint: '/api/analyses/score', methode: 'POST' });
  });
});
