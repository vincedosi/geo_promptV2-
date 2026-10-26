/**
 * POST /api/isochrone-battle-v2 contre la VRAIE base locale : la borne TECHNIQUE d'une bataille sans territoire
 * (retours du 26/10, T2). Seule l'identité de l'appelant est simulée (l'espace propriétaire de la source).
 *
 * Aucune borne produit sur le nombre de points (Vincent, Q-1) : seules comptent la lecture des POI (500, tronquée
 * au-delà) et la capacité synchrone de 700 anneaux RÉELLEMENT trouvés en cache. Au-delà, le message promet la tâche de
 * fond. Un territoire (département, région, ville) n'est jamais borné ici.
 *
 * Isochrones en cache mesurés le 26/10 : CIRFA 95 POI × {10, 15, 20, 30, 40, 50, 60} min + 41 à 5 min ;
 * BMW 160 × {10, 15, 20, 30}. Aucun cas ne lance une bataille de plus de 300 anneaux (durée).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { formaterNombre } from '@/lib/format/nombre';

let espaceActif: string | null = null;
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => (espaceActif ? { userId: 'essai-bataille-borne', orgId: espaceActif, role: 'client' } : null),
}));

const { POST } = await import('@/app/api/isochrone-battle-v2/route');
const sb = creerClientTest();

interface Ligne { type: string; message?: string; total?: number; count?: number; data?: { nb_pois: number } }

async function bataille(corps: Record<string, unknown>): Promise<Ligne[]> {
  const res = await POST(new NextRequest('http://localhost:3000/api/isochrone-battle-v2', {
    method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' },
  }));
  expect(res.status).toBe(200);
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ligne);
}

const SUITE = 'dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond';
let marine = '';
let bmw = '';

beforeAll(async () => {
  const { data, error } = await sb.from('organizations').select('id, slug').in('slug', ['marine', 'bmw-group']);
  if (error) throw new Error(error.message);
  marine = (data ?? []).find((o) => o.slug === 'marine')?.id as string;
  bmw = (data ?? []).find((o) => o.slug === 'bmw-group')?.id as string;
  if (!marine || !bmw) throw new Error('espaces `marine` et `bmw-group` attendus en base locale');
});

describe('bataille V2 — borne technique sans territoire, base locale', () => {
  it('CIRFA en métropole, 3 paliers (285 anneaux) : calculée', async () => {
    espaceActif = marine;
    const l = await bataille({ category: 'cirfa', metropolitaine: true, paliers: [10, 20, 30] });
    expect(l.filter((x) => x.type === 'error')).toEqual([]);
    expect(l.at(-1)).toMatchObject({ type: 'result', data: { nb_pois: 95 } });
  }, 120_000);

  it('lycées sans territoire : 500 POI lus, lecture tronquée → la tâche de fond, AVANT toute lecture du cache', async () => {
    espaceActif = marine;
    const l = await bataille({ category: 'lycee', metropolitaine: true, paliers: [10, 20], force_battle: true });
    expect(l).toEqual([{ type: 'error', message: expect.stringContaining(`500 POI ou plus × 2 paliers = ${formaterNombre(1000)} anneaux ou plus`) }]);
    expect(l[0].message).toContain(SUITE);
  });

  it('CIRFA sans territoire, 8 paliers : 706 anneaux en cache > 700 → la tâche de fond, chiffrée sur le cache', async () => {
    espaceActif = marine;
    const l = await bataille({ category: 'cirfa', metropolitaine: true, paliers: [5, 10, 15, 20, 30, 40, 50, 60], force_battle: true });
    expect(l.map((x) => x.type)).toEqual(['pois_loaded', 'error']);
    expect(l[1].message).toBe(`Ce calcul (95 POI × 8 paliers : 706 anneaux en cache) ${SUITE} dès le lot « calculs longs » ; `
      + 'en attendant, retirez des paliers ou choisissez une région.');
  });

  it('CIRFA sans territoire, 8 paliers dont 5 absents du cache : 285 anneaux trouvés, aucun refus', async () => {
    espaceActif = marine;
    const l = await bataille({ category: 'cirfa', metropolitaine: true, paliers: [10, 20, 30, 41, 42, 43, 44, 45] });
    expect(l.filter((x) => x.type === 'error')).toEqual([]);
    expect(l.at(-1)?.type).toBe('result');
  }, 120_000);

  it('BMW du département 13 : un territoire, jamais borné', async () => {
    espaceActif = bmw;
    const l = await bataille({ category: 'bmw', metropolitaine: true, filtre_depts: ['13'], paliers: [10, 20, 30] });
    expect(l.filter((x) => x.type === 'error')).toEqual([]);
    expect(l.at(-1)?.type).toBe('result');
  }, 120_000);
});
