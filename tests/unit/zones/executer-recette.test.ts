import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compterSommets, executerRecette } from '@/lib/zones/executer-recette';
import { recetteAEcrire } from '@/lib/zones/session-zones';
import { MESSAGES_REFUS, type Recette } from '@/lib/zones/recette';

const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const PER = { type: 'departement', code: '13' } as const;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const Z1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
const Z2 = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';
const Z3 = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';

let appels: { nom: string; args: Record<string, unknown> }[] = [];
let reponses: Record<string, { data: unknown; error: { message: string } | null }> = {};
let zonesDeLOrg: string[] = [];
/** Les zones de l'espace dont la recette est `pays` (sql/296). */
let zonesPays: string[] = [];
let lectures: { table: string; filtres: [string, unknown][] }[] = [];

/**
 * Le faux client est une CLASSE dont `rpc` lit `this` — comme le vrai `SupabaseClient`, dont `rpc` passe par
 * `this.rest`. Un appel détaché (`const f = supabase.rpc; f(nom, args)`) perd `this` et lève ici comme en
 * production : c'est le défaut que portait le plan (arbitrage P1), et ce faux le rend visible.
 */
class FauxClient {
  private readonly journal = appels;
  rpc(nom: string, args: Record<string, unknown>) {
    this.journal.push({ nom, args });
    return Promise.resolve(reponses[nom] ?? { data: null, error: { message: `rpc ${nom} non prévue` } });
  }
  from(table: string) {
    const lecture = { table, filtres: [] as [string, unknown][] };
    lectures.push(lecture);
    const chaine = {
      select() { return chaine; },
      eq(c: string, v: unknown) { lecture.filtres.push([c, v]); return chaine; },
      in(c: string, ids: string[]) {
        lecture.filtres.push([c, ids]);
        return Promise.resolve({
          data: ids.filter((i) => zonesDeLOrg.includes(i)).map((id) => ({ id, recette: zonesPays.includes(id) ? { v: 1, type: 'pays', code: 'FR' } : null })),
          error: null,
        });
      },
    };
    return chaine;
  }
}

const ctx: { orgId: string; sources: string[]; indicateurs?: ReadonlySet<string> } = {
  orgId: ORG, sources: ['s1'], indicateurs: new Set(['taux_pauvrete']),
};
const exec = (r: Recette, c: Partial<typeof ctx & { geometrie: unknown }> = {}) =>
  executerRecette(new FauxClient() as never, r, { ...ctx, ...c });

beforeEach(() => {
  appels = []; reponses = {}; zonesDeLOrg = []; zonesPays = []; lectures = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('executerRecette', () => {
  it('rayon POI : une seule RPC, le périmètre et les sources de l’espace', async () => {
    reponses.zone_rayon_poi = { data: { vide: false, compte: 12, geometry: CARRE, surface_km2: 4.2, part_retenue: 0.9 }, error: null };
    const r = await exec({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER });
    expect(r).toEqual({ ok: true, geometry: CARRE, surface_km2: 4.2, compte: 12, part_retenue: 0.9, population: null });
    expect(appels).toEqual([{ nom: 'zone_rayon_poi', args: {
      p_categorie: 'lycee', p_rayon_m: 5000, p_perimetre_type: 'departement', p_perimetre_code: '13',
      p_org_id: ORG, p_sources: ['s1'], p_max_poi: 10_000,
    } }]);
  });

  it('rayon POI sur la métropole : la capacité synchrone (10 000) en p_max_poi ; son refus, le message de tâche de fond', async () => {
    reponses.zone_rayon_poi = { data: { vide: false, compte: 5324, geometry: CARRE, surface_km2: 400_000, part_retenue: 0.8 }, error: null };
    const recette: Recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 20_000, perimetre: { type: 'france', code: 'METRO' } };
    expect(await exec(recette)).toMatchObject({ ok: true, compte: 5324 });
    expect(appels).toEqual([{ nom: 'zone_rayon_poi', args: {
      p_categorie: 'lycee', p_rayon_m: 20_000, p_perimetre_type: 'france', p_perimetre_code: 'METRO',
      p_org_id: ORG, p_sources: ['s1'], p_max_poi: 10_000,
    } }]);
    reponses.zone_rayon_poi = { data: { refus: 'trop_de_poi_metropole', plafond: 10_000 }, error: null };
    expect(await exec({ ...recette, categorie: 'arret_transport' })).toEqual({
      ok: false, statut: 422, refus: 'trop_de_poi_metropole', message: MESSAGES_REFUS.trop_de_poi_metropole,
    });
  });

  it('rayon POI sur une région trop dense (ICPE de Bretagne, 13 865) : la capacité, et la même promesse de tâche de fond', async () => {
    reponses.zone_rayon_poi = { data: { refus: 'trop_de_poi', plafond: 10_000 }, error: null };
    const r = await exec({ v: 1, type: 'rayon_poi', categorie: 'risque_industriel', rayon_m: 2000, perimetre: { type: 'region', code: '53' } });
    expect(r).toEqual({ ok: false, statut: 422, refus: 'trop_de_poi', message: MESSAGES_REFUS.trop_de_poi });
    expect(r.ok ? '' : r.message).toContain('tâche de fond');
    expect(appels[0].args.p_max_poi).toBe(10_000);
  });

  it('seuils sur la métropole : le message différé, SANS appel', async () => {
    const METRO = { type: 'france', code: 'METRO' } as const;
    for (const r of [
      { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: METRO, min_menages: 11 },
      { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '<=', seuil: 10, perimetre: METRO },
    ] as const) {
      expect(await exec(r)).toEqual({ ok: false, statut: 422, refus: 'seuil_metropole_differe', message: MESSAGES_REFUS.seuil_metropole_differe });
    }
    expect(appels).toEqual([]);
  });

  it('seuil sur carreaux et sur territoires : le périmètre et l’espace, la population remontée', async () => {
    reponses.zone_seuil_carreaux_min = { data: { vide: false, compte: 40, geometry: CARRE, surface_km2: 1.6, population: 5200 }, error: null };
    const c = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: PER, min_menages: 0 });
    expect(c).toMatchObject({ ok: true, compte: 40, population: 5200, part_retenue: null });
    // Une recette migrée (A5, sql/310 : `min_menages = 0` écrit) : sa valeur, telle quelle, jamais un défaut serveur.
    expect(appels.at(-1)).toEqual({ nom: 'zone_seuil_carreaux_min', args: {
      p_indicateur: 'part_men_pauv', p_operateur: '>=', p_seuil: 40,
      p_perimetre_type: 'departement', p_perimetre_code: '13', p_org_id: ORG, p_min_menages: 0,
    } });
    await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: PER, min_menages: 11 });
    expect(appels.at(-1)).toMatchObject({ nom: 'zone_seuil_carreaux_min', args: { p_min_menages: 11 } });
    reponses.zone_seuil_territoire = { data: { vide: false, compte: 3, geometry: CARRE, surface_km2: 9 }, error: null };
    await exec({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '<=', seuil: 10, perimetre: PER });
    expect(appels.at(-1)).toEqual({ nom: 'zone_seuil_territoire', args: {
      p_indicateur: 'taux_pauvrete', p_operateur: '<=', p_seuil: 10,
      p_perimetre_type: 'departement', p_perimetre_code: '13', p_org_id: ORG,
    } });
  });

  it('périmètre absent, national, ou région pour un seuil sur carreaux : 422 SANS appel', async () => {
    for (const perimetre of [null, { type: 'france', code: 'FR' } as const, { type: 'region', code: '75' } as const]) {
      const r = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre, min_menages: 11 });
      expect(r).toMatchObject({ ok: false, statut: 422 });
    }
    expect(appels).toEqual([]);
  });

  it('refus SQL : 422 et le message français', async () => {
    reponses.zone_seuil_carreaux_min = { data: { refus: 'trop_de_carreaux', plafond: 20000 }, error: null };
    const r = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 10, perimetre: PER, min_menages: 11 });
    expect(r).toEqual({ ok: false, statut: 422, refus: 'trop_de_carreaux', message: MESSAGES_REFUS.trop_de_carreaux });
    // `formaterNombre` sépare les milliers par une espace insécable : `\s` la reconnaît, une espace tapée non.
    expect(r.ok ? '' : r.message).toMatch(/^Plus de 20\s000 carreaux retenus : resserrez le périmètre ou relevez le seuil\.$/);
  });

  it('refus SQL inconnu du contrat : 500, jamais un message vide', async () => {
    reponses.zone_rayon_poi = { data: { refus: 'refus_pas_prevu' }, error: null };
    const r = await exec({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER });
    expect(r).toEqual({ ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' });
  });

  it('seuil sur territoires, indicateur invisible de l’espace (sql/288) : refusé comme un inconnu, SANS appel', async () => {
    const SEUIL = { v: 1, type: 'seuil_territoire', indicateur: 'abstention_pres_2022', operateur: '>=', seuil: 30, perimetre: PER } as const;
    const attendu = { ok: false, statut: 422, refus: 'indicateur_inconnu', message: MESSAGES_REFUS.indicateur_inconnu };
    expect(await exec(SEUIL)).toEqual(attendu);
    // Sans liste d'indicateurs : fermé par défaut.
    expect(await exec({ ...SEUIL, indicateur: 'taux_pauvrete' }, { indicateurs: undefined })).toEqual(attendu);
    expect(appels).toEqual([]);
    // Même réponse que la RPC sur un code inconnu : `{ refus: 'indicateur_inconnu' }` → 422, même message.
    reponses.zone_seuil_territoire = { data: { refus: 'indicateur_inconnu' }, error: null };
    expect(await exec({ ...SEUIL, indicateur: 'taux_pauvrete' })).toEqual(attendu);
  });

  it('forme vide : 409 « forme_vide », jamais une zone sans surface', async () => {
    reponses.zone_seuil_territoire = { data: { vide: true, compte: 0, geometry: null }, error: null };
    const r = await exec({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 99, perimetre: PER });
    expect(r).toMatchObject({ ok: false, statut: 409, refus: 'forme_vide' });
  });

  it('recette recalculable : une géométrie fournie est IGNORÉE', async () => {
    reponses.get_admin_filter_geometry = { data: { geometry: CARRE }, error: null };
    const r = await exec({ v: 1, type: 'codes_postaux', codes: ['13001'] }, { geometrie: { type: 'Polygon', coordinates: [] } });
    expect(r).toMatchObject({ ok: true, geometry: CARRE });
    expect(appels).toEqual([{ nom: 'get_admin_filter_geometry', args: { p_scale: 'cp', p_codes: ['13001'] } }]);
  });

  it('rayon autour d’un point : zone_rayon, sans lecture de table', async () => {
    reponses.zone_rayon = { data: { vide: false, geometry: CARRE, surface_km2: 3.1, part_retenue: 1 }, error: null };
    const r = await exec({ v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 1000 });
    expect(r).toMatchObject({ ok: true, surface_km2: 3.1 });
    expect(appels).toEqual([{ nom: 'zone_rayon', args: { p_lon: 5, p_lat: 43, p_rayon_m: 1000 } }]);
  });

  it('forme figée : géométrie obligatoire, validée et découpée par zone_dessin', async () => {
    expect(await exec({ v: 1, type: 'dessin' })).toMatchObject({ ok: false, statut: 400 });
    expect(await exec({ v: 1, type: 'dessin' }, { geometrie: { type: 'Point', coordinates: [5, 43] } })).toMatchObject({ ok: false, statut: 400 });
    expect(appels).toEqual([]);
    reponses.zone_dessin = { data: { vide: false, geometry: CARRE, surface_km2: 1, part_retenue: 1 }, error: null };
    const r = await exec({ v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, { geometrie: CARRE });
    expect(r).toMatchObject({ ok: true, geometry: CARRE });
    expect(appels.at(-1)).toEqual({ nom: 'zone_dessin', args: { p_geojson: CARRE } });
  });

  it('import de plus de 20 000 sommets : 422 SANS appel', async () => {
    const anneau = Array.from({ length: 20_001 }, (_, i) => [5 + i * 1e-6, 43]);
    const r = await exec({ v: 1, type: 'import', format: 'geojson', fichier: 'a.json' }, { geometrie: { type: 'Polygon', coordinates: [anneau] } });
    expect(r).toMatchObject({ ok: false, statut: 422, refus: 'trop_de_sommets' });
    expect(appels).toEqual([]);
  });

  it('combinaison : opérandes hors espace → 404 ; sinon union par get_composite_zone_geometry', async () => {
    zonesDeLOrg = [Z1];
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: false, statut: 404, refus: 'zone_introuvable' });
    expect(appels).toEqual([]);
    expect(lectures).toEqual([{ table: 'custom_geo_zones', filtres: [['org_id', ORG], ['id', [Z1, Z2]]] }]);
    zonesDeLOrg = [Z1, Z2];
    reponses.get_composite_zone_geometry = { data: { geometry: CARRE }, error: null };
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: true });
    expect(appels.at(-1)).toEqual({ nom: 'get_composite_zone_geometry', args: { p_zone_ids: [Z1, Z2] } });
    reponses.zone_difference = { data: { vide: false, geometry: CARRE, surface_km2: 1 }, error: null };
    await exec({ v: 1, type: 'combinaison', operation: 'difference', zones: [Z1, Z2] });
    expect(appels.at(-1)).toEqual({ nom: 'zone_difference', args: { p_base: Z1, p_retires: [Z2] } });
    reponses.zone_intersection = { data: { vide: false, geometry: CARRE, surface_km2: 1 }, error: null };
    await exec({ v: 1, type: 'combinaison', operation: 'intersection', zones: [Z1, Z2] });
    expect(appels.at(-1)).toEqual({ nom: 'zone_intersection', args: { p_zone_ids: [Z1, Z2] } });
  });

  it('combinaison : une opérande pays (zone nationale) est refusée pour les trois opérations, sans calcul', async () => {
    zonesDeLOrg = [Z1, Z2];
    zonesPays = [Z2];
    for (const operation of ['union', 'difference', 'intersection'] as const) {
      const r = await exec({ v: 1, type: 'combinaison', operation, zones: [Z1, Z2] });
      expect(r).toEqual({ ok: false, statut: 422, refus: 'operande_pays', message: MESSAGES_REFUS.operande_pays });
    }
    expect(appels).toEqual([]);
    expect(MESSAGES_REFUS.operande_pays).toContain('zone nationale');
  });

  it('intersection : EXACTEMENT deux zones (la RPC calcule première ∩ union des autres), refus sinon et sans appel', async () => {
    zonesDeLOrg = [Z1, Z2, Z3];
    for (const zones of [[Z1], [Z1, Z2, Z3]]) {
      const r = await exec({ v: 1, type: 'combinaison', operation: 'intersection', zones });
      expect(r).toEqual({ ok: false, statut: 400, refus: null, message: 'L’intersection se fait entre deux zones.' });
    }
    expect(appels).toEqual([]);
    expect(lectures).toEqual([]);
  });

  it('union et différence : deux zones au moins, refus (jamais un 500) sinon et sans appel', async () => {
    zonesDeLOrg = [Z1];
    for (const operation of ['union', 'difference'] as const) {
      const r = await exec({ v: 1, type: 'combinaison', operation, zones: [Z1] });
      expect(r).toMatchObject({ ok: false, statut: 400, refus: null });
    }
    expect(appels).toEqual([]);
    expect(lectures).toEqual([]);
  });

  it('erreur Postgres : 500 en français, détail en console seulement', async () => {
    reponses.zone_rayon = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const r = await exec({ v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 1000 });
    expect(r).toEqual({ ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('zone_rayon'), 'canceling statement due to statement timeout');
  });

  it('argument refusé par la base (22023) : 400, pas un 500', async () => {
    reponses.zone_seuil_carreaux_min = { data: null, error: { message: 'seuil invalide', code: '22023' } as { message: string } };
    const r = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 10, perimetre: PER, min_menages: 11 });
    expect(r).toEqual({ ok: false, statut: 400, refus: null, message: 'Paramètres de calcul invalides.' });
  });

  it('forme sans surface refusée par zone_dessin (22023) : un message qui parle de la forme ; les autres 22023 inchangés', async () => {
    const forme = { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]] };
    for (const message of ['geometrie sans surface', 'geometrie non surfacique (LINESTRING)']) {
      reponses.zone_dessin = { data: null, error: { message, code: '22023' } as { message: string } };
      expect(await exec({ v: 1, type: 'dessin' }, { geometrie: forme }))
        .toEqual({ ok: false, statut: 400, refus: null, message: 'La forme dessinée n’a pas de surface.' });
    }
    reponses.zone_dessin = { data: null, error: { message: 'autre chose', code: '22023' } as { message: string } };
    expect(await exec({ v: 1, type: 'dessin' }, { geometrie: forme }))
      .toEqual({ ok: false, statut: 400, refus: null, message: 'Paramètres de calcul invalides.' });
  });

  it('forme figée mal construite : 400 AVANT tout appel (positions, anneaux fermés de 4 positions au moins)', async () => {
    const malFormees: unknown[] = [
      { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.2]]] }, // anneau non fermé
      { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5, 43]]] }, // 3 positions
      { type: 'Polygon', coordinates: [[[5, 43], [5.1, 'x'], [5.1, 43.1], [5, 43]]] }, // coordonnée non numérique
      { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43, 0], [5.1, 43.1], [5, 43]]] }, // 3 nombres
      { type: 'Polygon', coordinates: [[[5, 43], [Infinity, 43], [5.1, 43.1], [5, 43]]] }, // non fini
      { type: 'Polygon', coordinates: [] }, // aucun anneau
      { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]], [[[6, 44], [6.1, 44]]]] },
      { type: 'MultiPolygon', coordinates: [] }, // aucun polygone
      { type: 'MultiPolygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]] }, // profondeur d'un Polygon
    ];
    for (const geometrie of malFormees) {
      const r = await exec({ v: 1, type: 'import', format: 'geojson', fichier: 'a.json' }, { geometrie });
      expect(r, JSON.stringify(geometrie)).toMatchObject({ ok: false, statut: 400, refus: null });
    }
    expect(appels).toEqual([]);
  });

  it('union de zones sans géométrie (P0001 « aucune geometrie trouvee ») : 409 forme_vide', async () => {
    zonesDeLOrg = [Z1, Z2];
    reponses.get_composite_zone_geometry = { data: null, error: { message: 'composite: aucune geometrie trouvee', code: 'P0001' } as { message: string } };
    const r = await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] });
    expect(r).toEqual({ ok: false, statut: 409, refus: 'forme_vide', message: MESSAGES_REFUS.forme_vide });
  });

  it('une autre P0001 de get_composite_zone_geometry reste un 500', async () => {
    zonesDeLOrg = [Z1, Z2];
    reponses.get_composite_zone_geometry = { data: null, error: { message: 'composite: 2 a 20 zones membres requises (recu 1)', code: 'P0001' } as { message: string } };
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: false, statut: 500 });
  });

  it('une réponse jsonb sérialisée en texte est lue comme un objet', async () => {
    reponses.get_composite_zone_geometry = { data: JSON.stringify({ geometry: CARRE }), error: null };
    zonesDeLOrg = [Z1, Z2];
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: true, geometry: CARRE });
  });
});

describe('compterSommets', () => {
  it('Polygon, MultiPolygon, et 0 pour autre chose', () => {
    expect(compterSommets(CARRE)).toBe(5);
    expect(compterSommets({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]], [[0.1, 0.1], [0.2, 0.1], [0.1, 0.2], [0.1, 0.1]]] })).toBe(8);
    expect(compterSommets({ type: 'Point', coordinates: [0, 0] })).toBe(0);
    expect(compterSommets(null)).toBe(0);
  });
});

describe('B15 — les unités constitutives, posées par le serveur', () => {
  const SCORE = { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' as const }], maille: 'cp' as const, seuil_score: 60 };

  it('seuil sur territoires : les codes rendus par la RPC deviennent les unités de la zone (et ceux du client sont écrasés)', async () => {
    reponses.zone_seuil_territoire = { data: { vide: false, compte: 2, maille: 'cp', codes: ['13001', '13002'], geometry: CARRE, surface_km2: 9 }, error: null };
    const recette: Recette = {
      v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: PER,
      unites_constitutives: { maille: 'cp', codes: ['99999'], groupes_partiels: 0 },
    };
    const r = await exec(recette);
    expect(r).toMatchObject({ ok: true, unites: { maille: 'cp', codes: ['13001', '13002'] } });
    if (!r.ok) throw new Error('attendu ok');
    expect(recetteAEcrire(recette, r)).toEqual({ ...recette, unites_constitutives: { maille: 'cp', codes: ['13001', '13002'] } });
  });

  it('capture de score avec ses CP : la forme est l’union de CES codes (get_admin_filter_geometry), jamais celle du client', async () => {
    reponses.get_admin_filter_geometry = { data: { geometry: CARRE, metadata: {} }, error: null };
    const recette: Recette = {
      v: 1, type: 'capture', source_type: 'score', parametres: SCORE, unites_constitutives: { maille: 'cp', codes: ['13001', '13002'] },
    };
    const r = await exec(recette, { geometrie: { type: 'Polygon', coordinates: [[[0, 0], [9, 0], [0, 9], [0, 0]]] } });
    expect(appels).toEqual([{ nom: 'get_admin_filter_geometry', args: { p_scale: 'cp', p_codes: ['13001', '13002'] } }]);
    expect(r).toMatchObject({ ok: true, geometry: CARRE, unites: { maille: 'cp', codes: ['13001', '13002'] } });
  });

  it('capture sans unités, dessin : aucune unité ; une clé envoyée sans calcul serveur est retirée', async () => {
    reponses.zone_dessin = { data: { vide: false, geometry: CARRE, surface_km2: 1 }, error: null };
    const r = await exec({ v: 1, type: 'capture', source_type: 'composite' }, { geometrie: CARRE });
    expect(r.ok && 'unites' in r).toBe(false);
    if (!r.ok) throw new Error('attendu ok');
    const forgee = { v: 1, type: 'seuil_territoire', indicateur: 'x', operateur: '>=', seuil: 1, perimetre: PER, unites_constitutives: { maille: 'iris', codes: ['130010101'] } } as const;
    expect(recetteAEcrire(forgee, r)).toEqual({ v: 1, type: 'seuil_territoire', indicateur: 'x', operateur: '>=', seuil: 1, perimetre: PER });
    expect(recetteAEcrire({ v: 1, type: 'codes_postaux', codes: ['13001'] }, r)).toEqual({ v: 1, type: 'codes_postaux', codes: ['13001'] });
  });
});
