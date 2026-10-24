/**
 * Découpages `commune` et `departement` de la couverture (sql/275, lot 5, T3) — la maille TikTok lue comme le CP : même
 * règle d'attribution (le carreau entier au territoire de son centroïde, premier code `lcog_geo`, sql/266), mêmes refus,
 * même cache.
 *
 * Ce que ce fichier prouve :
 *   - la composite de 13 000 km² (copiée dans un espace de test) rend ≈ 1 410 communes et 91 départements (mesure M3 du
 *     plan) ; chaque découpage est une PARTITION de la forme ; aucune part > 100 % ;
 *   - une zone couvrant Paris rend ses ARRONDISSEMENTS (751xx), jamais la commune 75056 : c'est la maille de
 *     `carreau_couverture.code_commune` (Q-B du plan : TikTok les accepte-t-il ? « À vérifier »);
 *   - deux appels `commune` : le second est servi du cache ;
 *   - un dénominateur communal reconstruit APRÈS la table étroite refuse le calcul et périme le cache (règle du CP) ;
 *   - la jumelle `carreaux_de_forme_codes` rend les mêmes carreaux que `carreaux_de_forme` (enveloppe mince).
 *
 * Les zones sont créées dans un espace de test supprimé (cascade) en fin de fichier ; les pannes de base sont simulées
 * par psql dans des transactions ANNULÉES (base locale partagée).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 180_000;
/** « Cible composite (2 zones) — juil. 2026 », 13 000 km², la zone des mesures M1-M5 du plan. */
const COMPOSITE = '919ca65d-665a-43f6-834e-ea9f2eb68c72';

interface Ligne { code: string; nom: string | null; commune: string | null; pop_en_zone: number; pop_totale: number | null; part: number | null }
interface Resultat {
  refus?: string; motif?: string; cache?: boolean; decoupage: string; population: number; n_carreaux: number;
  lignes: Ligne[]; hors_territoire: { n_carreaux: number; population: number }; n_territoires: number;
}

let org = '';
const zones: Record<string, string> = {};

async function couverture(zone: string, decoupage: string): Promise<Resultat> {
  const { data, error } = await admin.rpc('couverture_geometrie', { p_zone_id: zone, p_org_id: org, p_decoupage: decoupage });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Resultat;
}

/** Somme des lignes + hors territoire = population de la forme (arrondis : 0,5 par ligne au plus) ; parts ≤ 100. */
function verifierPartition(r: Resultat, forme: Resultat) {
  expect(r.refus).toBeUndefined();
  const somme = r.lignes.reduce((s, l) => s + l.pop_en_zone, 0) + r.hors_territoire.population;
  expect(Math.abs(somme - forme.population)).toBeLessThanOrEqual(0.5 * (r.lignes.length + 1) + 0.5);
  expect(r.population).toBe(forme.population);
  expect(r.n_territoires).toBe(r.lignes.length);
  for (const l of r.lignes) {
    expect(l.pop_totale, l.code).not.toBeNull();
    expect(l.part!, l.code).toBeLessThanOrEqual(100);
    // Un territoire à peine effleuré (un carreau sur 50 000 habitants) arrondit sa part à 0,0 : jamais négative.
    expect(l.part!, l.code).toBeGreaterThanOrEqual(0);
    expect(l.pop_en_zone, l.code).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI lot5 T3] couverture commune', slug: `essai-lot5-t3-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  org = data.id as string;
  // Copie de la composite (15 décimales : la forme exacte) : son cache vit et meurt avec l'espace de test.
  zones.composite = psql(`select public.creer_zone_recette('Composite (copie)', '${org}', null, '{"v":1,"type":"dessin"}',
                            ST_AsGeoJSON(geometry, 15))->>'id' from public.custom_geo_zones where id = '${COMPOSITE}';`);
  if (!zones.composite) throw new Error(`zone composite ${COMPOSITE} absente de la base`);
  zones.paris = psql(`select public.creer_zone_recette('Paris', '${org}', null, '{"v":1,"type":"dessin"}', ST_AsGeoJSON(r.g))->>'id'
                        from public.resoudre_perimetre('departement', '75', null, 100000, array['departement']) r;`);
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('couverture_geometrie par commune et par département — composite 13 000 km² (M3)', () => {
  it('commune : ≈ 1 410 communes, partition exacte, nommées', async () => {
    const forme = await couverture(zones.composite, 'forme');
    const r = await couverture(zones.composite, 'commune');
    expect(r.decoupage).toBe('commune');
    expect(Math.abs(r.n_territoires - 1410)).toBeLessThanOrEqual(15);
    verifierPartition(r, forme);
    expect(r.lignes.filter((l) => l.nom !== null).length).toBeGreaterThan(r.lignes.length * 0.95);
    expect(r.lignes.every((l) => /^[0-9][0-9AB][0-9]{3}$/.test(l.code))).toBe(true);
  }, LONG);

  it('département : 91 départements, partition exacte, nommés', async () => {
    const forme = await couverture(zones.composite, 'forme');
    const r = await couverture(zones.composite, 'departement');
    expect(r.n_territoires).toBe(91);
    verifierPartition(r, forme);
    expect(r.lignes.every((l) => l.nom !== null && l.commune === null)).toBe(true);
  }, LONG);
});

describe('couverture_geometrie par commune — Paris', () => {
  it('une zone couvrant le 75 rend les 20 ARRONDISSEMENTS (751xx), jamais la commune 75056', async () => {
    const forme = await couverture(zones.paris, 'forme');
    const r = await couverture(zones.paris, 'commune');
    verifierPartition(r, forme);
    const parisiens = r.lignes.filter((l) => l.code.startsWith('751'));
    expect(parisiens).toHaveLength(20);
    expect(r.lignes.some((l) => l.code === '75056')).toBe(false);
    expect(parisiens.find((l) => l.code === '75101')?.nom).toBe('Paris 1er Arrondissement');
    const dep = await couverture(zones.paris, 'departement');
    expect(dep.lignes[0]).toMatchObject({ code: '75', nom: 'Paris' });
  }, LONG);
});

describe('cache et fraîcheur des dénominateurs commune / département', () => {
  it('deux appels commune : le second est servi du cache, mêmes chiffres', async () => {
    const appel = async () => {
      const { data, error } = await admin.rpc('couverture_zone', { p_zone_id: zones.paris, p_org_id: org, p_cible: 'ind', p_decoupage: 'commune' });
      if (error) throw new Error(`${error.code} ${error.message}`);
      return data as Resultat;
    };
    const a = await appel();
    const b = await appel();
    expect(a.cache).toBe(false);
    expect(b.cache).toBe(true);
    expect(b.lignes).toEqual(a.lignes);
    expect(psql(`select count(*) from public.couverture_zone_cache where zone_id = '${zones.paris}' and decoupage = 'commune';`)).toBe('1');
  }, LONG);

  it('dénominateur reconstruit après la table étroite : refus, et le cache n\'est plus servi', () => {
    for (const maille of ['commune', 'departement']) {
      const r = psql(`begin;
        select public.couverture_zone('${zones.paris}', '${org}', 'ind', '${maille}') is not null;
        update public.unite_population_totale set construit_le = clock_timestamp() + interval '1 hour'
         where maille = '${maille}' and code = (select min(code) from public.unite_population_totale where maille = '${maille}');
        select jsonb_build_object('calcul', public.couverture_geometrie('${zones.paris}', '${org}', 'ind', '${maille}'),
                                  'cache', public.couverture_zone_en_cache('${zones.paris}', '${org}', 'ind', '${maille}'))::text;
        rollback;`);
      expect(JSON.parse(r), maille).toEqual({
        calcul: { refus: 'couverture_non_construite', motif: `denominateur_${maille}_plus_recent` }, cache: null,
      });
    }
  });
});

describe('carreaux_de_forme_codes — la jumelle porte le corps', () => {
  it('mêmes carreaux, mêmes effectifs, mêmes CP et IRIS que carreaux_de_forme ; quatre codes', () => {
    const r = psql(`with g as (select geometry from public.custom_geo_zones where id = '${zones.paris}'),
                         a as (select f.* from g, public.carreaux_de_forme(g.geometry, 1) f),
                         b as (select f.* from g, public.carreaux_de_forme_codes(g.geometry, 1) f)
                    select (select count(*) from a) || '|' ||
                           (select count(*) from a full join b using (carreau_id)
                             where a.pop is distinct from b.pop or a.code_postal is distinct from b.code_postal
                                or a.code_iris is distinct from b.code_iris) || '|' ||
                           (select count(*) from b where b.code_commune like '751%' and b.code_departement = '75') || '|' ||
                           (select count(*) from b where b.code_departement is distinct from
                              case when left(b.code_commune, 2) in ('97', '98') then left(b.code_commune, 3) else left(b.code_commune, 2) end);`);
    const [n, ecarts, parisiens, horsRegle] = r.split('|').map(Number);
    expect(n).toBeGreaterThan(2000);
    expect(ecarts).toBe(0);
    // Le périmètre du 75 touche quelques carreaux de bordure que `lcog_geo` rattache à une commune voisine (≈ 3 %).
    expect(parisiens).toBeGreaterThan(n * 0.95);
    expect(horsRegle).toBe(0);
  });
});
