/**
 * POST /api/map/pois contre la VRAIE base locale : les POI affichés respectent le périmètre (retours du 26/10, T1).
 *
 * Seule l'identité de l'appelant est simulée : une session de l'espace `marine`, propriétaire de la source CIRFA
 * (privée). Les lycées sont au socle. La route, PostgREST et `poi_france` sont les vrais.
 *
 * Quatre défauts verrouillés :
 *   - la portée `metro` filtrait par `departement not in (971…976)` : elle laissait passer le CIRFA de Nouméa (988)
 *     et les lycées d'outre-mer dont `departement` porte un NOM (« La Réunion »…). Elle borne désormais par
 *     `BBOX_METRO` sur `lat`/`lng` ;
 *   - six CIRFA portaient la région « PACA », que l'écriture du référentiel ne trouvait pas (sql/282) ;
 *   - le code postal n'était pas un périmètre de la route (paramètre `code_postal`, index sql/283) ;
 *   - le département 2A doit trouver le CIRFA écrit « 20A ».
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { BBOX_METRO } from '@/lib/carte/filtre';

let espaceActif: string | null = null;
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => (espaceActif ? { userId: 'essai-pois-perimetre', orgId: espaceActif, role: 'client' } : null),
}));

const { POST } = await import('@/app/api/map/pois/route');
const sb = creerClientTest();

interface Poi { id: string; lat: number; lng: number }

async function pois(corps: Record<string, unknown>): Promise<Poi[]> {
  const res = await POST(new NextRequest('http://localhost:3000/api/map/pois', {
    method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' },
  }));
  const json = await res.json() as { pois?: Poi[]; error?: string };
  expect(res.status, json.error).toBe(200);
  return json.pois ?? [];
}

const [O, S, E, N] = BBOX_METRO;
const dansMetro = (p: Poi) => p.lat >= S && p.lat <= N && p.lng >= O && p.lng <= E;

let cpCirfa = '';
let idCirfaCp = '';
let lyceesHorsMetro: Set<string>;

beforeAll(async () => {
  const { data: org, error: eo } = await sb.from('organizations').select('id').eq('slug', 'marine').maybeSingle();
  if (eo) throw new Error(eo.message);
  espaceActif = (org?.id as string | undefined) ?? null;
  if (!espaceActif) throw new Error('espace `marine` absent de la base locale');

  // Un CIRFA seul sur son code postal, lu dans la base plutôt que supposé.
  const { data: cirfa, error: ec } = await sb.from('poi_france').select('id, code_postal').eq('categorie', 'cirfa');
  if (ec) throw new Error(ec.message);
  const parCp = new Map<string, string[]>();
  for (const c of cirfa ?? []) {
    if (!/^\d{5}$/.test(c.code_postal ?? '')) continue;
    parCp.set(c.code_postal as string, [...(parCp.get(c.code_postal as string) ?? []), c.id as string]);
  }
  const seul = [...parCp.entries()].find(([, ids]) => ids.length === 1);
  if (!seul) throw new Error('aucun CIRFA seul sur son code postal');
  [cpCirfa, [idCirfaCp]] = seul;

  // Les lycées d'outre-mer, désignés par leur région (DROM ou « TOM… ») : une lecture indépendante de la route.
  const { data: om, error: el } = await sb.from('poi_france').select('id').eq('categorie', 'lycee')
    .or('region.in.(Guadeloupe,Martinique,Guyane,La Réunion,Mayotte),region.ilike.TOM*');
  if (el) throw new Error(el.message);
  lyceesHorsMetro = new Set((om ?? []).map((l) => l.id as string));
});

describe('POST /api/map/pois — périmètre, base locale', () => {
  it('cirfa en métropole : 95 POI, tous dans BBOX_METRO, pas Nouméa', async () => {
    const r = await pois({ poi_types: ['cirfa'], scope: 'metro' });
    expect(r).toHaveLength(95);
    expect(r.filter((p) => !dansMetro(p))).toEqual([]);
  });

  it('lycées en métropole : aucun lycée d un DROM ou d un TOM', async () => {
    expect(lyceesHorsMetro.size).toBeGreaterThan(0);
    const r = await pois({ poi_types: ['lycee'], scope: 'metro' });
    expect(r.length).toBeGreaterThan(5000);
    expect(r.filter((p) => lyceesHorsMetro.has(p.id))).toEqual([]);
  });

  it('cirfa en région 93 : les 6 CIRFA de Provence-Alpes-Côte d Azur', async () => {
    expect(await pois({ poi_types: ['cirfa'], regions: ['93'] })).toHaveLength(6);
  });

  it('cirfa en département 2A : le CIRFA écrit « 20A »', async () => {
    expect(await pois({ poi_types: ['cirfa'], depts: ['2A'] })).toHaveLength(1);
  });

  it('cirfa par code postal : ce CIRFA seul', async () => {
    const r = await pois({ poi_types: ['cirfa'], code_postal: cpCirfa });
    expect(r.map((p) => p.id)).toEqual([idCirfaCp]);
  });

  it('cirfa du 06300 : le CIRFA de Nice, dont le CP était écrit « 6300 » (sql/286)', async () => {
    const r = await pois({ poi_types: ['cirfa'], code_postal: '06300' });
    expect(r).toHaveLength(1);
    const { data, error } = await sb.from('poi_france').select('ville').eq('id', r[0].id).single();
    if (error) throw new Error(error.message);
    expect(data.ville).toBe('Nice');
  });

  it('cirfa sur toute la France (outre-mer compris) : 101', async () => {
    expect(await pois({ poi_types: ['cirfa'], scope: 'all' })).toHaveLength(101);
  });
});
