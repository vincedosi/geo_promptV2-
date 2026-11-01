/**
 * `couverture_geometrie` (sql/269, lot 4, T5) — chiffrer une zone enregistrée TELLE QUELLE, ou découpée par code postal
 * ou par IRIS, sans jamais la convertir (spec § 16.2-2). Lecture seule, `jsonb`, bornée.
 *
 * Ce que ce fichier prouve :
 *   - les chiffres de référence du plan (mesures A, recoupées en T3) sur un rayon de 5 km autour de Lyon ;
 *   - un découpage est une PARTITION : somme des lignes + hors territoire = population de la forme ;
 *   - un CP entièrement dans la zone vaut 100 % (le département 13 après T2 : fin du « 13100 à 92,5 % ») ;
 *   - ③ et ④ comptent les MÊMES carreaux (zone `seuil_carreaux` : même règle centroïde, `ST_Intersects` + `distinct on`) ;
 *   - Q-J : une zone sans carroyage (Guadeloupe) rend 0 AVEC un motif, et toute réponse porte la référence nationale ;
 *   - les refus (zone d'un autre espace, cible, zone trop vaste, plafond, table non certifiée, dénominateur IRIS périmé).
 *
 * Les zones sont créées par `creer_zone_recette` dans deux espaces de test, supprimés (cascade) en fin de fichier. Les
 * scénarios de panne sont simulés par psql dans des transactions ANNULÉES (base locale partagée).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 120_000;

interface Ligne { code: string; nom: string | null; commune: string | null; pop_en_zone: number; pop_totale: number | null; part: number | null }
interface Resultat {
  refus?: string; motif?: string; plafond?: number;
  zone_id: string; cible: string; decoupage: string; surface_km2: number; n_carreaux: number; population: number;
  lignes: Ligne[]; hors_territoire: { n_carreaux: number; population: number }; n_territoires: number;
  motif_vide: string | null; territoires_non_carroyes: { code: string; nom: string | null }[];
  reference: { source: string; millesime: string; population_france: number; n_carreaux_france: number };
  base_construite_le: string; calcule_le: string;
}

let org = '';
let autreOrg = '';
const zones: Record<string, string> = {};
let compteSeuil = 0;

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI lot4 T5] ${nom}`, slug: `essai-lot4-t5-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

async function creerZone(nom: string, type: string, geojson: string, o = org): Promise<string> {
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: o, p_cree_par: null, p_recette: { v: 1, type }, p_geometry_geojson: geojson,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

const carre = (o: number, s: number, e: number, n: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] });

async function couverture(zone: string, args: Record<string, unknown> = {}): Promise<Resultat> {
  const { data, error } = await admin.rpc('couverture_geometrie', { p_zone_id: zone, p_org_id: org, ...args });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Resultat;
}

/** Somme des lignes + hors territoire, rapprochée de la population de la forme (arrondis : 0,5 par ligne au plus). */
function verifierPartition(r: Resultat, forme: Resultat) {
  const somme = r.lignes.reduce((s, l) => s + l.pop_en_zone, 0) + r.hors_territoire.population;
  expect(Math.abs(somme - forme.population)).toBeLessThanOrEqual(0.5 * (r.lignes.length + 1) + 0.5);
  expect(r.n_territoires).toBe(r.lignes.length);
  for (const l of r.lignes) {
    if (l.part !== null) expect(l.part).toBeLessThanOrEqual(100);
    expect(l.pop_en_zone).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');

  const { data: rayon, error } = await admin.rpc('zone_rayon', { p_lon: 4.8357, p_lat: 45.764, p_rayon_m: 5000 });
  if (error) throw new Error(error.message);
  zones.lyon = await creerZone('Lyon 5 km', 'rayon_point', JSON.stringify((rayon as { geometry: unknown }).geometry));
  zones.lyonAutre = await creerZone('Lyon 5 km (autre espace)', 'rayon_point',
    JSON.stringify((rayon as { geometry: unknown }).geometry), autreOrg);

  // Le département 13 tel que ① le résout APRÈS T2 (périmètre sans interstices), figé comme un dessin.
  zones.dept13 = psql(`select public.creer_zone_recette('Département 13', '${org}', null, '{"v":1,"type":"dessin"}',
                        ST_AsGeoJSON(r.g))->>'id'
                         from public.resoudre_perimetre('departement', '13', null, 100000, array['departement']) r;`);

  // Une zone fabriquée par ③ : l'union des carreaux retenus (ménages pauvres ≥ 40 %, Bouches-du-Rhône).
  const seuil = psql(`select (z->>'compte') || '|' || (public.creer_zone_recette('Seuil carreaux', '${org}', null,
                        '{"v":1,"type":"seuil_carreaux","min_menages":0}', (z->'geometry')::text)->>'id')
                        from public.zone_seuil_carreaux('part_men_pauv', '>=', 40, 'departement', '13', null, 20000) z;`)
    .split('|');
  compteSeuil = Number(seuil[0]);
  zones.seuil = seuil[1];

  zones.guadeloupe = await creerZone('Pointe-à-Pitre', 'dessin', carre(-61.56, 16.22, -61.50, 16.27));
  zones.mer = await creerZone('Golfe du Lion, au large', 'dessin', carre(4.0, 42.6, 4.1, 42.7));
  zones.vaste = await creerZone('Rectangle de 180 000 km²', 'dessin', carre(0, 44, 5, 48));
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('couverture_geometrie — rayon de 5 km autour de Lyon (mesures A du plan)', () => {
  it('telle quelle : 1 661 carreaux, 649 832 habitants, aucune ligne', async () => {
    const r = await couverture(zones.lyon);
    expect(r.refus).toBeUndefined();
    expect(r.decoupage).toBe('forme');
    expect(r.cible).toBe('ind');
    expect(r.n_carreaux).toBe(1661);
    expect(Math.abs(r.population - 649_832)).toBeLessThanOrEqual(649_832 * 0.005);
    expect(r.lignes).toEqual([]);
    expect(r.n_territoires).toBe(0);
    expect(r.hors_territoire).toEqual({ n_carreaux: 0, population: 0 });
    expect(r.motif_vide).toBeNull();
    expect(r.territoires_non_carroyes).toEqual([]);
    expect(r.surface_km2).toBeGreaterThan(78);
    expect(r.surface_km2).toBeLessThan(79);
  });

  it('par code postal : 21 CP, 69100 à ≈ 83,7 %, partition exacte, triée par population décroissante', async () => {
    const forme = await couverture(zones.lyon);
    const r = await couverture(zones.lyon, { p_decoupage: 'cp' });
    expect(r.n_territoires).toBe(21);
    expect(r.lignes).toHaveLength(21);
    const villeurbanne = r.lignes.find((l) => l.code === '69100')!;
    expect(villeurbanne.part).toBeGreaterThan(83.2);
    expect(villeurbanne.part).toBeLessThan(84.2);
    expect(villeurbanne.nom).toBeTruthy();
    const pops = r.lignes.map((l) => l.pop_en_zone);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
    expect(r.population).toBe(forme.population);
    verifierPartition(r, forme);
  });

  it('par IRIS : 266 IRIS, nommés, partition exacte', async () => {
    const forme = await couverture(zones.lyon);
    const r = await couverture(zones.lyon, { p_decoupage: 'iris' });
    expect(r.n_territoires).toBe(266);
    expect(r.lignes.every((l) => l.nom !== null && l.commune !== null && l.pop_totale !== null)).toBe(true);
    verifierPartition(r, forme);
  });

  // A5 (ARB-4, sql/310) : hors population totale, seuls les carreaux d'au moins `min_menages_cible` ménages comptent.
  it('cible men_pauv : la somme des ménages pauvres des carreaux d’au moins 11 ménages, lue indépendamment dans carreaux_filosofi', async () => {
    const r = await couverture(zones.lyon, { p_cible: 'men_pauv' });
    const min = Number(psql(`select valeur from public.reglages_conversion where cle = 'min_menages_cible';`));
    const attendu = Number(psql(`
      with z as materialized (select ST_Subdivide(ST_Transform(geometry, 3857), 256) g
                                from public.custom_geo_zones where id = '${zones.lyon}'),
           c as materialized (select distinct on (cf.id) (cf.metadata->>'men_pauv')::numeric v, (cf.metadata->>'men')::numeric men
                                from public.carreaux_filosofi cf
                                join z on cf.geom_3857 && z.g and ST_Intersects(ST_Centroid(cf.geom_3857), z.g)
                               order by cf.id)
      select round(sum(v) filter (where men >= ${min})) from c;`));
    expect(r.cible).toBe('men_pauv');
    expect(Math.abs(r.population - attendu)).toBeLessThanOrEqual(1);
  });

  it('Q-J : la référence nationale accompagne tout chiffre (carroyage Filosofi, 63,8 M, millésime)', async () => {
    const r = await couverture(zones.lyon);
    expect(r.reference.source).toMatch(/Filosofi/);
    expect(r.reference.millesime).toBe('2021');
    expect(r.reference.n_carreaux_france).toBe(2_324_577);
    expect(Math.abs(r.reference.population_france - 63_783_568)).toBeLessThan(10);
    const men = await couverture(zones.lyon, { p_cible: 'men' });
    expect(men.reference.population_france).toBeLessThan(r.reference.population_france);
  });

  it('T6 : la date de construction de la base est exposée (celle du journal des bandes)', async () => {
    const r = await couverture(zones.lyon);
    const attendu = psql('select to_jsonb(max(construit_le)) #>> \'{}\' from public.carreau_couverture_bandes;');
    expect(new Date(r.base_construite_le).getTime()).toBe(new Date(attendu).getTime());
    expect(r.calcule_le).toBeTruthy();
  });
});

describe('couverture_geometrie — département 13 figé comme dessin (après T2)', () => {
  it('par CP : 13100 (Aix) à 100,0 %, plus aucune part > 100 %', async () => {
    const forme = await couverture(zones.dept13);
    const r = await couverture(zones.dept13, { p_decoupage: 'cp' });
    expect(r.lignes.find((l) => l.code === '13100')?.part).toBe(100);
    expect(Math.abs(forme.population - 1_906_414)).toBeLessThanOrEqual(50);
    verifierPartition(r, forme);
  }, LONG);
});

describe('couverture_geometrie — ③ et ④ comptent les mêmes carreaux', () => {
  it('couture de ST_Subdivide : ③, ④ et la couverture par rayon comptent le carreau qui la touche', async () => {
    // Un carré de ±1 000 m (3857) autour du centroïde du carreau 457209, segmenté à 10 m : ses deux morceaux de
    // ST_Subdivide se touchent SUR ce centroïde. `ST_Intersects` + `distinct on` le compte une fois ; `ST_Contains`
    // par morceau le perdrait (47 au lieu de 48 : vérifié ci-dessous, sinon le cas ne prouverait rien). 15 décimales :
    // les 9 par défaut d'ST_AsGeoJSON déplacent la couture.
    const zone = psql(`select public.creer_zone_recette('Couture 457209', '${org}', null, '{"v":1,"type":"dessin"}',
                         ST_AsGeoJSON(ST_Transform(ST_Segmentize(ST_Expand(centroide_3857, 1000), 10), 4326), 15))->>'id'
                         from public.carreau_couverture where carreau_id = 457209;`);
    const parContains = Number(psql(`select count(distinct cc.carreau_id)
                                       from public.custom_geo_zones z
                                       cross join lateral ST_Subdivide(ST_Transform(z.geometry, 3857), 256) m
                                       join public.carreau_couverture cc on ST_Contains(m, cc.centroide_3857)
                                      where z.id = '${zone}';`));
    const quatre = await couverture(zone);
    expect(quatre.n_carreaux).toBe(48);
    expect(parContains).toBe(47);
    const trois = Number(psql(`select z->>'compte' from public.zone_seuil_carreaux('densite_ind', '>=', 0, 'zone', '${zone}', '${org}') z;`));
    expect(trois).toBe(quatre.n_carreaux);
    const rayon = JSON.parse(psql(`select public.couverture_rayon_poi('lycee', 'zone', '${zone}', '${org}', null, 'ind', 1000);`));
    expect(rayon.population_perimetre).toBe(quatre.population);
  }, LONG);

  it('zone seuil_carreaux : n_carreaux = le nombre de carreaux que ③ a retenus', async () => {
    const r = await couverture(zones.seuil);
    expect(compteSeuil).toBeGreaterThan(100);
    expect(r.n_carreaux).toBe(compteSeuil);
  });
});

describe('couverture_geometrie — zones sans habitant carroyé (Q-J)', () => {
  it('Guadeloupe : 0 habitant, MAIS le motif le dit — le carroyage ne couvre pas ce territoire', async () => {
    const r = await couverture(zones.guadeloupe, { p_decoupage: 'cp' });
    expect(r.refus).toBeUndefined();
    expect(r.population).toBe(0);
    expect(r.n_carreaux).toBe(0);
    expect(r.motif_vide).toBe('territoire_non_carroye');
    expect(r.territoires_non_carroyes.map((t) => t.code)).toEqual(['971']);
  });

  it('en mer : 0 habitant, motif « aucun carreau habité »', async () => {
    const r = await couverture(zones.mer);
    expect(r.population).toBe(0);
    expect(r.motif_vide).toBe('aucun_carreau');
    expect(r.territoires_non_carroyes).toEqual([]);
  });
});

describe('couverture_geometrie — refus et garde-fous', () => {
  it('zone d\'un AUTRE espace : zone_introuvable ; id inconnu : la même réponse', async () => {
    expect(await couverture(zones.lyonAutre)).toEqual({ refus: 'zone_introuvable' });
    expect(await couverture('00000000-0000-4000-8000-000000000000')).toEqual({ refus: 'zone_introuvable' });
  });

  it('cible inconnue', async () => {
    expect(await couverture(zones.lyon, { p_cible: 'xxx' })).toEqual({ refus: 'cible_inconnue' });
  });

  it('zone de plus de 100 000 km² : zone_trop_vaste, sans lecture de carreaux', async () => {
    const r = await couverture(zones.vaste);
    expect(r.refus).toBe('zone_trop_vaste');
  });

  it('plafond de carreaux : trop_de_carreaux, jamais un chiffre partiel', async () => {
    expect(await couverture(zones.lyon, { p_max_carreaux: 10 })).toEqual({ refus: 'trop_de_carreaux', plafond: 10 });
  });

  it('découpage hors liste ou plafond hors bornes : 22023', async () => {
    const a = await admin.rpc('couverture_geometrie', { p_zone_id: zones.lyon, p_org_id: org, p_decoupage: 'canton' });
    expect(a.error?.code).toBe('22023');
    const b = await admin.rpc('couverture_geometrie', { p_zone_id: zones.lyon, p_org_id: org, p_max_carreaux: 400001 });
    expect(b.error?.code).toBe('22023');
  });

  it('table non certifiée complète (bande réécrite après la certification) : couverture_non_construite + motif', () => {
    const r = JSON.parse(psql(`begin;
      update public.carreau_couverture_bandes set construit_le = clock_timestamp() + interval '1 second'
       where bande = (select min(bande) from public.carreau_couverture_bandes);
      select public.couverture_geometrie('${zones.lyon}', '${org}')::text;
      rollback;`));
    expect(r).toEqual({ refus: 'couverture_non_construite', motif: 'modifiee_depuis_certification' });
  });

  it('dénominateur IRIS plus ancien que la table : le découpage IRIS refuse, la forme répond', () => {
    // Table reconstruite ET recertifiée après le dénominateur : le scénario « script relancé, 11-reconstruire non ».
    const avant = `begin;
      update public.carreau_couverture_bandes set construit_le = clock_timestamp() + interval '1 hour'
       where bande = (select min(bande) from public.carreau_couverture_bandes);
      update public.carreau_couverture_controle set certifie_le = clock_timestamp() + interval '2 hours';`;
    const iris = JSON.parse(psql(`${avant}
      select public.couverture_geometrie('${zones.lyon}', '${org}', 'ind', 'iris')::text; rollback;`));
    expect(iris).toEqual({ refus: 'couverture_non_construite', motif: 'denominateur_iris_perime' });
    const forme = JSON.parse(psql(`${avant}
      select public.couverture_geometrie('${zones.lyon}', '${org}', 'ind', 'forme')::text; rollback;`));
    expect(forme.n_carreaux).toBe(1661);
  });

  it('droits : service_role seul', () => {
    expect(psql(`select has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text
                        || has_function_privilege('service_role', p.oid, 'execute')::text
                   from pg_proc p where p.proname = 'couverture_geometrie';`)).toBe('falsefalsetrue');
  });
});
