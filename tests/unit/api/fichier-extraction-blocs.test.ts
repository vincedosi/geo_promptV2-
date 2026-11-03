/**
 * B14 round 1 (I-2) : `GET /api/zones/jeux/[id]/extractions/[version]/fichier` suit les blocs du découpage (ARB-6) —
 * `&bloc=N` rend les seules unités du bloc ; sans `bloc` alors qu'il y en a plusieurs, 422 et la liste des blocs, jamais
 * un fichier au-dessus de la limite de la plateforme. Base simulée (lecture paginée comprise) ; le chemin contre la
 * vraie base : `tests/integration/fichier-extraction.test.ts`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const JEU = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';

/** 3 500 communes TikTok retenues — 3 000 au bloc 1, 500 au bloc 2 — et une non retenue. */
const UNITES = [
  ...Array.from({ length: 3500 }, (_, i) => ({
    ordinal: i + 1, code: String(10000 + i), nom: `Commune ${i}`, centre: null, rayon_m: null, retenu: true, bloc: i < 3000 ? 1 : 2,
  })),
  { ordinal: 3501, code: '99999', nom: 'Hors', centre: null, rayon_m: null, retenu: false, bloc: null },
];
const h = { unites: UNITES as unknown[], resume: { plateforme: 'tiktok', maille: 'commune' } as Record<string, unknown>, lues: [] as string[] };

const TABLES: Record<string, () => unknown> = {
  zone_sets: () => ({ id: JEU, org_id: ORG, nom: 'Communes TikTok', type: 'zone' }),
  zone_set_extractions: () => ({ id: 'x1', version: 1, plateformes: [h.resume] }),
  plateformes_geo: () => ({ a_verifier: false, releve_le: '2026-11-02' }),
  zone_set_extraction_unites: () => h.unites,
};

/** Une requête enchaînable minimale ; `range` découpe la liste comme PostgREST (lecture paginée de `lireTout`). */
function requete(table: string) {
  h.lues.push(table);
  let page: [number, number] | null = null;
  const fin = () => {
    const d = TABLES[table]();
    return { data: Array.isArray(d) && page ? d.slice(page[0], page[1] + 1) : d, error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  q.range = (de: number, a: number) => { page = [de, a]; return q; };
  q.maybeSingle = async () => fin();
  q.single = async () => fin();
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(fin()).then(ok, ko);
  return q;
}

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'client', organization_id: ORG }),
  authUnauthorized: () => Response.json({ error: 'Non authentifié' }, { status: 401 }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  rateLimitResponse: () => Response.json({ error: 'Trop de requêtes' }, { status: 429 }),
}));
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (table: string) => requete(table) }),
}));

const { GET } = await import('@/app/api/zones/jeux/[id]/extractions/[version]/fichier/route');

const lire = (suite = '') => GET(
  new NextRequest(`http://localhost/api/zones/jeux/${JEU}/extractions/1/fichier?plateforme=tiktok&format=territoires${suite}`),
  { params: Promise.resolve({ id: JEU, version: '1' }) },
);
const lignes = (texte: string) => texte.replace(/^﻿/, '').split('\n').filter((l) => !l.startsWith('#')).slice(1);

beforeEach(() => {
  h.unites = UNITES;
  h.resume = { plateforme: 'tiktok', maille: 'commune' };
  h.lues = [];
});

describe('revue T6 (I-8) : l’en-tête lit la règle FIGÉE dans l’extraction, pas le registre du jour', () => {
  it('« à vérifier » figé (ligne et paramètres) : écrit, et le registre n’est pas relu', async () => {
    h.resume = { plateforme: 'tiktok', maille: 'commune', regle_figee: { a_verifier: true, releve_le: '2026-10-30', parametres_a_verifier: ['max_unites'] } };
    const texte = await (await lire('&bloc=1')).text();
    expect(texte).toContain('# Relevé des limites de la plateforme : 2026-10-30');
    expect(texte).toContain('# À vérifier : la règle de ciblage de cette plateforme n’a pas été confirmée sur sa documentation.');
    expect(texte).toContain('# À vérifier, paramètres : nombre d’unités par liste');
    expect(h.lues).not.toContain('plateformes_geo');
  });
  it('une extraction d’avant la revue (rien de figé) : le registre, comme avant', async () => {
    const texte = await (await lire('&bloc=1')).text();
    expect(texte).toContain('# Relevé des limites de la plateforme : 2026-11-02');
    expect(h.lues).toContain('plateformes_geo');
  });
});

describe('fichier d’une extraction découpée en blocs', () => {
  it('3 500 communes : deux fichiers, de 3 000 puis 500 lignes, chacun nommé par son bloc', async () => {
    for (const [bloc, n] of [[1, 3000], [2, 500]] as const) {
      const r = await lire(`&bloc=${bloc}`);
      expect(r.status).toBe(200);
      const texte = await r.text();
      expect(lignes(texte)).toHaveLength(n);
      expect(texte).toContain(`# Bloc : ${bloc} sur 2`);
      expect(r.headers.get('Content-Disposition')).toContain(`_tiktok_territoires_bloc${bloc}.csv`);
    }
  });

  it('sans bloc : 422, la liste des blocs — jamais les 3 500 d’un tenant', async () => {
    const r = await lire();
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ blocs: [{ numero: 1, n_unites: 3000 }, { numero: 2, n_unites: 500 }] });
  });

  it('un bloc qui n’existe pas : 404 ; un bloc illisible : 400', async () => {
    expect((await lire('&bloc=3')).status).toBe(404);
    expect((await lire('&bloc=0')).status).toBe(400);
  });

  it('une extraction sans découpage : le fichier entier, comme avant', async () => {
    h.unites = [{ ordinal: 1, code: '13', nom: 'Bouches-du-Rhône', centre: null, rayon_m: null, retenu: true, bloc: null }];
    const r = await lire();
    expect(r.status).toBe(200);
    expect(lignes(await r.text())).toEqual(['13;Bouches-du-Rhône']);
  });
});
