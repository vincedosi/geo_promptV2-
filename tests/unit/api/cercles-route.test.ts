import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/[id]/cercles?cible=&rayon=&seuil=&plateforme=` (lot 5, T8) — une zone pavée en cercles pour UNE
 * plateforme, aux limites de la plateforme lues dans `plateformes_geo` (jamais du client, § 16.2-3).
 *
 * Ce que ces tests verrouillent, au-delà des statuts :
 * - l'ordre : session → paramètres → quota → règle de la plateforme → RPC ; une requête invalide ne touche pas la base ;
 * - un rayon hors des bornes de la PLATEFORME est refusé (400) AVANT la RPC, qui n'a que des bornes de sécurité ;
 * - les limites passées à la RPC sont celles de la ligne lue ; l'espace est celui de la session ;
 * - chaque refus de `paver_cercles` a son statut et son message français (`MESSAGES_CONVERSION`), chiffres compris.
 */
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';

import { formaterNombre } from '@/lib/format/nombre';
import { ORG, etat, reinitialiser } from './_doublures-route';

vi.mock('@/lib/api/middleware', () => import('./_doublures-route'));
vi.mock('@/lib/api/rate-limit', () => import('./_doublures-route'));
vi.mock('@/lib/auth', () => import('./_doublures-route'));
const { GET } = await import('@/app/api/zones/[id]/cercles/route');

const appel = (id: string, query = '?cible=ind&rayon=10000&seuil=20&plateforme=meta') =>
  GET(new Request(`http://localhost/api/zones/${id}/cercles${query}`) as never, { params: Promise.resolve({ id }) });

const ligne = (plateforme: string, maille: string, limites: Record<string, number>, disponible = true, note: string | null = null) => ({
  plateforme, maille, libelle: `${plateforme} ${maille}`, natif: true, disponible, limites, doc_url: null,
  releve_le: '2026-10-14', a_verifier: false, note, ordre: 1,
});
const REGLES = [
  ligne('meta', 'cercle', { max_unites: 200, rayon_min_m: 1000, rayon_max_m: 80000 }),
  ligne('meta', 'cp', { max_unites: 50000 }),
  // B13 (sql/318) : le comportement du minimum par cercle, lu dans le registre — `refus` = filtre dur au pavage.
  { ...ligne('dv360', 'cercle', { rayon_min_m: 1000, pop_min_unite: 1000 }), pop_min_unite_comportement: 'refus' },
  ligne('ttd', 'cercle', {}),
  ligne('tiktok', 'cercle', {}, false, 'TikTok ne cible pas un rayon en France.'),
];

const PAVAGE = {
  zone_id: ZONE, cible: 'ind', rayon_m: 10000, seuil: 20, pop_min: 0, n_candidates: 12, n_cercles: 3,
  cercles: [{ lon: 4.83, lat: 45.76, pop_en_zone: 1000, pop_totale: 1200, part: 83.3 }],
  population: 5000, couverte: 4000, manques: 1000, hors_zone: 800, achetee: 4800, taux_utile: 83.3, n_carreaux: 200,
  motif_vide: null, territoires_non_carroyes: [], reference: {}, calcule_le: '2026-10-24T10:00:00Z',
};

beforeEach(() => {
  reinitialiser();
  etat.tables.plateformes_geo = { data: REGLES, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('source de la route', () => {
  it('garde requireAuth( (routes-publiques), force-dynamic, maxDuration 60, jamais getUser ni Map locale', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/cercles/route.ts', 'utf8');
    expect(s).toContain('requireAuth(');
    expect(s).toContain("dynamic = 'force-dynamic'");
    expect(s).toMatch(/maxDuration\s*=\s*60/);
    expect(s).not.toContain('getUser(');
    expect(s).not.toMatch(/new Map\(/);
  });
  it('UN limiteur : 6 / 60 s / compte, préfixe geo:rl:conversion', () => {
    expect(etat.limiteurs.filter((l) => l.prefix === 'geo:rl:conversion'))
      .toEqual([{ max: 6, window: '60 s', prefix: 'geo:rl:conversion' }]);
  });
});

describe('session, paramètres, quota — rien en base', () => {
  it('sans profil : 401 ; sans espace actif : 403', async () => {
    etat.profil = null; expect((await appel(ZONE)).status).toBe(401);
    etat.profil = { id: 'u1', role: 'client', organization_id: null }; expect((await appel(ZONE)).status).toBe(403);
    expect(etat.rpcs).toEqual([]); expect(etat.quotas).toEqual([]); expect(etat.lectures).toEqual([]);
  });
  it('id non UUID : 404 zone_introuvable', async () => {
    const r = await appel('pas-un-uuid');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
    expect(etat.quotas).toEqual([]);
  });
  it.each([
    ['rayon absent', '?cible=ind&seuil=20&plateforme=meta'],
    ['rayon non entier', '?cible=ind&rayon=10.5&seuil=20&plateforme=meta'],
    ['seuil au-delà de 100', '?cible=ind&rayon=10000&seuil=150&plateforme=meta'],
    ['seuil absent', '?cible=ind&rayon=10000&plateforme=meta'],
    ['plateforme inconnue', '?cible=ind&rayon=10000&seuil=20&plateforme=snap'],
    ['cible mal formée', '?cible=X%3BDROP&rayon=10000&seuil=20&plateforme=meta'],
  ])('400 en français : %s — sans jeton ni lecture', async (_n, q) => {
    const r = await appel(ZONE, q);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^[A-ZÉ]/);
    expect(etat.quotas).toEqual([]); expect(etat.lectures).toEqual([]); expect(etat.rpcs).toEqual([]);
  });
  it('quota épuisé : 429, rien lu', async () => {
    etat.quotaOk = false;
    expect((await appel(ZONE)).status).toBe(429);
    expect(etat.quotas).toEqual(['geo:rl:conversion:u1']);
    expect(etat.lectures).toEqual([]); expect(etat.rpcs).toEqual([]);
  });
});

describe('les règles de la plateforme, lues en base', () => {
  it('rayon sous la borne lue (Meta, 500 m) : 400, RPC non appelée', async () => {
    const r = await appel(ZONE, '?cible=ind&rayon=500&seuil=20&plateforme=meta');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe(`Rayon de 500 m hors des bornes de meta (${formaterNombre(1000)} à ${formaterNombre(80000)} m).`);
    expect(etat.lectures).toEqual([{ table: 'plateformes_geo', filtres: [['in', 'plateforme', ['meta']]] }]);
    expect(etat.rpcs).toEqual([]);
  });
  it('maille indisponible (TikTok) : 400 avec la note de la table', async () => {
    const r = await appel(ZONE, '?cible=ind&rayon=10000&seuil=20&plateforme=tiktok');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('La maille cercle n’est pas disponible chez tiktok : TikTok ne cible pas un rayon en France.');
    expect(etat.rpcs).toEqual([]);
  });
  it('lecture des règles en échec : 500 neutre', async () => {
    etat.tables.plateformes_geo = { data: null, error: { message: 'boom' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect((await r.json()).error).not.toContain('boom');
  });
});

describe('paver_cercles', () => {
  it('200 : les limites de Meta (200 cercles) et l’espace de la session partent à la RPC', async () => {
    etat.reponses.paver_cercles = { data: PAVAGE, error: null };
    const r = await appel(ZONE, '?cible=ind&rayon=10000&seuil=20&plateforme=meta&org=autre');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(PAVAGE);
    expect(etat.rpcs).toEqual([{ nom: 'paver_cercles', args: {
      p_zone_id: ZONE, p_org_id: ORG, p_cible: 'ind', p_rayon_m: 10000, p_seuil: 20, p_pop_min: undefined, p_max_cercles: 200,
    } }]);
  });
  it('DV360 : la population minimale d’un cercle, sans plafond', async () => {
    etat.reponses.paver_cercles = { data: PAVAGE, error: null };
    await appel(ZONE, '?cible=ind&rayon=5000&seuil=30&plateforme=dv360');
    expect(etat.rpcs[0].args).toMatchObject({ p_rayon_m: 5000, p_seuil: 30, p_pop_min: 1000, p_max_cercles: undefined });
  });
  it('B13 : un minimum en `avertissement` au registre ne filtre rien au pavage', async () => {
    etat.tables.plateformes_geo = { data: REGLES.map((r) => (r.plateforme === 'dv360' ? { ...r, pop_min_unite_comportement: 'avertissement' } : r)), error: null };
    etat.reponses.paver_cercles = { data: PAVAGE, error: null };
    await appel(ZONE, '?cible=ind&rayon=5000&seuil=30&plateforme=dv360');
    expect(etat.rpcs[0].args).toMatchObject({ p_pop_min: undefined });
  });
  it('422 trop_de_cercles : le nombre, le plafond, et le plus petit rayon qui passe (B10), cherché un pavage à la fois', async () => {
    // n ∝ 1 / r² : 481 cercles à 10 km → il faut r ≥ 15,51 km, soit 16 km au pas de 500 m.
    etat.reponses.paver_cercles = (args) => {
      const n = Math.ceil(481 * (10_000 / (args.p_rayon_m as number)) ** 2);
      return { data: n > 200 ? { refus: 'trop_de_cercles', n_cercles: n, plafond: 200 } : { ...PAVAGE, n_cercles: n }, error: null };
    };
    const r = await appel(ZONE);
    expect(r.status).toBe(422);
    const corps = await r.json();
    expect(corps).toMatchObject({
      error: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.',
      refus: 'trop_de_cercles', n_cercles: 481, plafond: 200,
      rayon_propose: { rayon_m: 16_000, au_pas: true },
    });
    expect(corps.rayon_propose.n_cercles).toBeLessThanOrEqual(200);
    // Le premier pavage, puis au plus six essais — tous aux limites de la ligne lue.
    expect(etat.rpcs.length).toBeLessThanOrEqual(7);
    expect(etat.rpcs.length).toBe(1 + corps.rayon_propose.essais);
    for (const c of etat.rpcs) expect(c.args).toMatchObject({ p_max_cercles: 200, p_seuil: 20 });
    // Tour 1 (I-1) : UN jeton de quota par pavage, la requête comprise — le quota borne les pavages, pas les requêtes.
    expect(etat.quotas).toHaveLength(etat.rpcs.length);
    expect(new Set(etat.quotas)).toEqual(new Set(['geo:rl:conversion:u1']));
  });
  it('quota épuisé pendant la recherche : arrêt, le meilleur connu et le dernier rayon essayé, dits', async () => {
    let appels = 0;
    etat.reponses.paver_cercles = (args) => {
      appels += 1;
      if (appels === 2) etat.quotaOk = false; // le jeton du 3e pavage sera refusé
      const n = Math.ceil(481 * (10_000 / (args.p_rayon_m as number)) ** 2);
      return { data: n > 200 ? { refus: 'trop_de_cercles', n_cercles: n, plafond: 200 } : { ...PAVAGE, n_cercles: n }, error: null };
    };
    const r = await appel(ZONE);
    expect(r.status).toBe(422);
    const corps = await r.json();
    expect(etat.rpcs).toHaveLength(2);
    expect(corps).toMatchObject({ refus: 'trop_de_cercles', n_cercles: 481, rayon_propose: { au_pas: false } });
    expect(corps.interrompue).toMatchObject({ cause: 'quota', dernier_rayon_m: corps.rayon_propose.rayon_m });
  });
  it('source : un budget de temps nommé sous maxDuration, passé à la recherche', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('app/api/zones/[id]/cercles/route.ts', 'utf8');
    const { BUDGET_RECHERCHE_RAYON_MS } = await import('@/lib/zones/conversion-serveur');
    expect(BUDGET_RECHERCHE_RAYON_MS).toBeLessThan(60_000);
    expect(s).toContain('BUDGET_RECHERCHE_RAYON_MS');
  });
  it('422 trop_de_cercles sans rayon sous le plafond jusqu’au maximum de la plateforme : rien de proposé, dit', async () => {
    etat.reponses.paver_cercles = { data: { refus: 'trop_de_cercles', n_cercles: 5_000_000, plafond: 200 }, error: null };
    const corps = await (await appel(ZONE)).json();
    expect(corps).toMatchObject({ rayon_propose: null, sans_proposition: { motif: 'aucun_sous_plafond', rayon_max_m: 80_000 } });
  });
  it.each([
    ['zone_introuvable', 404], ['cible_inconnue', 422], ['zone_trop_vaste', 422], ['trop_de_candidates', 422],
    ['couverture_non_construite', 503],
  ])('refus %s : %i', async (refus, statut) => {
    etat.reponses.paver_cercles = { data: { refus }, error: null };
    const r = await appel(ZONE);
    expect(r.status).toBe(statut);
    expect((await r.json()).refus).toBe(refus);
  });
  it('22023 (borne de sécurité de la RPC, ex. TTD sans borne) : 400 ; autre erreur : 500 sans détail', async () => {
    etat.reponses.paver_cercles = { data: null, error: { code: '22023', message: 'rayon hors bornes' } };
    expect((await appel(ZONE, '?cible=ind&rayon=300000&seuil=20&plateforme=ttd')).status).toBe(400);
    etat.reponses.paver_cercles = { data: null, error: { code: 'XX000', message: 'secret' } };
    const r = await appel(ZONE);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
  });
});
