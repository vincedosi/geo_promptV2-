/**
 * C21 (plan de corrections du découpage des zones, 2026-10-31, lot 3) — « zone nationale moins zones locales »
 * (sql/326).
 *
 * Une différence dont la première zone est une zone pays se chiffre par les agrégats nationaux MOINS la couverture de
 * l'union des zones retirées, sans lire un carreau de la partie nationale (`couverture_pays_moins_jsonb`, appelée par
 * `couverture_zone`). Ce fichier prouve, contre la base locale :
 *   - France métropolitaine moins un rayon de 30 km autour de Lyon : population nationale moins population du rayon
 *     comptée par le national (les carreaux sans CP, C25, ne sont pas dans le national : non retirés, et dits) ;
 *   - au CP : Σ lignes = population, aucune ligne négative, un CP entièrement dans le rayon disparaît, un CP à cheval
 *     vaut national(CP) − partie dans le rayon (au plus fort reste près), un CP non touché garde sa ligne nationale ;
 *   - département disponible, IRIS et commune refusés (`decoupage_trop_fin_pays`) ;
 *   - deux zones retirées qui se chevauchent ne sont retirées qu'une fois ;
 *   - `couverture_pays_jsonb` (l'enveloppe) rend toujours la couverture nationale ;
 *   - les compteurs de « Mes zones » (`compter_zone_pays`) : nationaux moins les CP entièrement retirés.
 *
 * Les zones de test vivent dans un espace de test, supprimé (cascade) en fin de fichier.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 180_000;
const LYON = { lon: 4.8357, lat: 45.764 };

let org = '';
const zones: Record<string, string> = {};

async function nouvelleOrg(): Promise<string> {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI C21] pays moins', slug: `essai-c21-pays-moins-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

async function creer(nom: string, recette: Record<string, unknown>, geometrie: unknown): Promise<string> {
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: org, p_cree_par: null, p_recette: recette, p_geometry_geojson: JSON.stringify(geometrie),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function rpc<T>(nom: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(nom, args);
  if (error) throw new Error(`${nom} : ${error.code} ${error.message}`);
  return data as T;
}

async function rayon(lon: number, lat: number, rayon_m: number): Promise<string> {
  const forme = await rpc<{ geometry: unknown }>('zone_rayon', { p_lon: lon, p_lat: lat, p_rayon_m: rayon_m });
  return creer(`Rayon ${rayon_m} m`, { v: 1, type: 'rayon_point', lon, lat, rayon_m }, forme.geometry);
}

/** Ce que fait `POST /api/zones` pour une différence : la forme par `zone_difference`, écrite par `creer_zone_recette`. */
async function difference(base: string, retires: string[]): Promise<string> {
  const forme = await rpc<{ geometry: unknown }>('zone_difference', { p_base: base, p_retires: retires });
  return creer('Pays moins', { v: 1, type: 'combinaison', operation: 'difference', zones: [base, ...retires] }, forme.geometry);
}

interface Ligne { code: string; pop_en_zone: number | null; pop_totale: number | null; part: number | null; part_brute: number | null; n_carreaux: number }
interface Couverture {
  refus?: string; pays?: string; population: number; n_carreaux: number; lignes: Ligne[];
  retire?: { n_carreaux: number; population: number; hors_national: { n_carreaux: number; population: number } };
  zones_retirees?: string[];
}

const couverture = (zone: string, decoupage: string, cible = 'ind') =>
  rpc<Couverture>('couverture_zone', { p_zone_id: zone, p_org_id: org, p_cible: cible, p_decoupage: decoupage });

/** La population (CP dans le pays, `ind`) des carreaux d'une ou plusieurs zones de test, en union, par code. */
function carreauxDe(ids: string[], cle: 'code_postal' | 'code_departement'): Map<string, number> {
  const lignes = psql(`
    with z as (select ST_Union(geometry) g from public.custom_geo_zones where id = any(array['${ids.join("','")}']::uuid[])),
         k as (select rang_pop from public.cibles_exposition where code = 'ind')
    select string_agg(s.c || ':' || s.p, ',') from (
      select f.${cle} as c, sum(f.pop) as p from z, k, public.carreaux_de_forme_menages(z.g, k.rang_pop, k.rang_pop) f
       where f.${cle} is not null and public.pays_contient_code('METRO', f.${cle}) group by 1) s;`);
  return new Map(lignes.split(',').map((x) => { const [c, p] = x.split(':'); return [c, Number(p)]; }));
}

beforeAll(async () => {
  org = await nouvelleOrg();
  const forme = await rpc<{ geometry: unknown }>('zone_pays_geometrie', { p_code: 'METRO' });
  zones.metro = await creer('France métropolitaine', { v: 1, type: 'pays', code: 'METRO' }, forme.geometry);
  zones.lyon = await rayon(LYON.lon, LYON.lat, 30_000);
  zones.lyonEst = await rayon(LYON.lon + 0.2, LYON.lat, 30_000);  // chevauche le premier
  zones.metroMoinsLyon = await difference(zones.metro, [zones.lyon]);
  zones.metroMoinsDeux = await difference(zones.metro, [zones.lyon, zones.lyonEst]);
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('C21 — France métropolitaine moins un rayon de 30 km autour de Lyon (sql/326)', () => {
  it('telle quelle : population nationale − population du rayon comptée par le national', async () => {
    const national = await couverture(zones.metro, 'forme');
    const rayonSeul = await rpc<{ population: number; hors_territoire: { population: number } }>('couverture_geometrie', {
      p_zone_id: zones.lyon, p_org_id: org, p_cible: 'ind', p_decoupage: 'cp',
    });
    const r = await couverture(zones.metroMoinsLyon, 'forme');
    expect(r.refus).toBeUndefined();
    expect(r.pays).toBe('METRO');
    expect(national.population).toBe(62_592_659);  // C25 (E7) : 62 528 975 avant le rattachement des carreaux sans CP
    // Le rayon compte aussi ses carreaux sans CP (C25) : absents du national, ils ne sont pas retirés, et sont dits.
    const rayonAuCp = rayonSeul.population - rayonSeul.hors_territoire.population;
    expect(r.retire?.population).toBe(rayonAuCp);
    expect(r.retire?.hors_national.population).toBe(rayonSeul.hors_territoire.population);
    expect(r.population).toBe(national.population - rayonAuCp);
    expect(r.zones_retirees).toEqual([zones.lyon]);
  }, LONG);

  it('au CP : Σ lignes = population, aucune ligne négative, CP du cœur retirés, CP non touchés intacts', async () => {
    const national = await couverture(zones.metro, 'cp');
    const r = await couverture(zones.metroMoinsLyon, 'cp');
    expect(r.refus).toBeUndefined();
    const chiffrees = r.lignes.filter((l) => l.pop_en_zone !== null);
    expect(chiffrees.reduce((s, l) => s + l.pop_en_zone!, 0)).toBe(r.population);
    expect(chiffrees.every((l) => l.pop_en_zone! >= 0 && l.n_carreaux >= 0)).toBe(true);
    expect(new Set(r.lignes.map((l) => l.code)).size).toBe(r.lignes.length);  // rien de doublé
    // 69001 (Lyon 1er) est entièrement dans le rayon : sa ligne disparaît.
    expect(national.lignes.some((l) => l.code === '69001')).toBe(true);
    expect(r.lignes.some((l) => l.code === '69001')).toBe(false);
    // Un CP loin de Lyon (Paris 1er) : sa ligne nationale à l'identique.
    const parisN = national.lignes.find((l) => l.code === '75001');
    expect(r.lignes.find((l) => l.code === '75001')).toEqual(parisN);
  }, LONG);

  it('un CP à cheval sur le rayon : sa ligne vaut national(CP) − partie dans le rayon, et reste ≥ 0', async () => {
    const national = new Map((await couverture(zones.metro, 'cp')).lignes.map((l) => [l.code, l]));
    const r = await couverture(zones.metroMoinsLyon, 'cp');
    const retire = carreauxDe([zones.lyon], 'code_postal');
    const brut = psql(`select string_agg(code_postal || ':' || (populations->>'ind'), ',') from public.cp_population_totale_e7
                        where code_postal = any(array['${[...retire.keys()].join("','")}'])`);
    const totaux = new Map(brut.split(',').map((x) => { const [c, p] = x.split(':'); return [c, Number(p)]; }));
    const aCheval = r.lignes.filter((l) => retire.has(l.code));
    expect(aCheval.length).toBeGreaterThan(0);
    for (const l of aCheval) {
      const reste = totaux.get(l.code)! - retire.get(l.code)!;
      expect(reste, l.code).toBeGreaterThan(0);
      expect([Math.floor(reste), Math.ceil(reste)], l.code).toContain(l.pop_en_zone);
      expect(l.pop_en_zone!, l.code).toBeGreaterThanOrEqual(0);
      expect(l.pop_totale, l.code).toBe(Math.round(totaux.get(l.code)!));
      expect(l.part_brute!, l.code).toBeCloseTo((100 * reste) / totaux.get(l.code)!, 9);
      expect(l.part_brute!, l.code).toBeLessThan(100);  // `part` est arrondie au dixième : 100,0 pour un CP à peine touché
      expect(national.get(l.code)!.pop_en_zone!, l.code).toBeGreaterThanOrEqual(l.pop_en_zone!);
    }
  }, LONG);

  it('au département : 69 = national(69) − rayon, Σ lignes = arrondi du total brut ; les autres intacts', async () => {
    const national = await couverture(zones.metro, 'departement');
    const r = await couverture(zones.metroMoinsLyon, 'departement');
    expect(r.refus).toBeUndefined();
    const retire = carreauxDe([zones.lyon], 'code_departement');
    const n69 = national.lignes.find((l) => l.code === '69')!;
    const l69 = r.lignes.find((l) => l.code === '69')!;
    const brut69 = Number(psql(`select populations->>'ind' from public.unite_population_totale_e7 where maille = 'departement' and code = '69'`));
    const reste = brut69 - retire.get('69')!;
    expect([Math.floor(reste), Math.ceil(reste)]).toContain(l69.pop_en_zone);
    expect(l69.pop_en_zone!).toBeLessThan(n69.pop_en_zone!);
    expect(r.lignes.find((l) => l.code === '13')).toEqual(national.lignes.find((l) => l.code === '13'));
    expect(r.lignes.every((l) => l.pop_en_zone === null || l.pop_en_zone >= 0)).toBe(true);
  }, LONG);

  it('IRIS et commune : refusés (sans objet sur un pays), comme la zone nationale', async () => {
    expect((await couverture(zones.metroMoinsLyon, 'iris')).refus).toBe('decoupage_trop_fin_pays');
    expect((await couverture(zones.metroMoinsLyon, 'commune')).refus).toBe('decoupage_trop_fin_pays');
  }, LONG);

  it('deux zones retirées qui se chevauchent : retirées une fois (national − union), jamais deux', async () => {
    const national = await couverture(zones.metro, 'forme');
    const r = await couverture(zones.metroMoinsDeux, 'forme');
    const union = [...carreauxDe([zones.lyon, zones.lyonEst], 'code_postal').values()].reduce((s, p) => s + p, 0);
    const lyon = [...carreauxDe([zones.lyon], 'code_postal').values()].reduce((s, p) => s + p, 0);
    const est = [...carreauxDe([zones.lyonEst], 'code_postal').values()].reduce((s, p) => s + p, 0);
    expect(union).toBeLessThan(lyon + est);  // ils se chevauchent bien
    expect(r.retire?.population).toBe(Math.round(union));
    // La population nationale BRUTE (une somme de demi-habitants) : le résultat est l'arrondi de la différence brute.
    const nationalBrut = Number(psql(`select sum((populations->>'ind')::numeric) from public.cp_population_totale_e7
                                       where public.pays_contient_code('METRO', code_postal)`));
    expect(Math.abs(nationalBrut - national.population)).toBeLessThanOrEqual(0.5);
    expect(r.population).toBe(Math.round(nationalBrut - union));
    const cp = await couverture(zones.metroMoinsDeux, 'cp');
    expect(cp.lignes.filter((l) => l.pop_en_zone !== null).reduce((s, l) => s + l.pop_en_zone!, 0)).toBe(cp.population);
  }, LONG);

  it('round 1 : un DROM non carroyé recouvert par la géométrie retirée garde ses lignes, et est NOMMÉ', () => {
    // FR moins un disque de 20 km dans la Guyane (non carroyée) : ses unités restent (population inconnue), dites.
    const r = psql(`with g as (select ST_SetSRID(ST_GeomFromGeoJSON((public.zone_rayon(-52.33, 4.93, 20000)->'geometry')::text), 4326) g),
                         j as (select public.couverture_pays_moins_jsonb('FR', 'ind', 'cp', (select g from g)) j)
                    select (j->'inconnues_recouvertes')::text || '|' ||
                           (select count(*) from jsonb_array_elements(j->'lignes') e where e->>'pop_en_zone' is null and e->>'code' like '973%') || '|' ||
                           (public.couverture_pays_moins_jsonb('METRO', 'ind', 'cp', (select g from g)) -> 'inconnues_recouvertes')::text
                      from j;`).split('|');
    expect(r[0]).toBe('[{"nom": "Guyane", "code": "973"}]');
    expect(Number(r[1])).toBeGreaterThan(0);
    expect(r[2]).toBe('[]');
  }, LONG);

  it('la zone pays seule est inchangée : couverture_pays_jsonb = l’enveloppe sans retrait', () => {
    const r = psql(`select (public.couverture_pays_jsonb('METRO', 'ind', 'cp') - 'calcule_le')
                         = (public.couverture_pays_moins_jsonb('METRO', 'ind', 'cp', null) - 'calcule_le'),
                           public.couverture_pays_jsonb('METRO', 'ind', 'forme') ? 'retire';`);
    expect(r).toBe('t|f');
  }, LONG);

  it('compteurs de « Mes zones » : nationaux moins les CP entièrement retirés, sans écrire de code', () => {
    const r = psql(`begin;
      insert into public.organization_members (user_id, organization_id) select id, '${org}' from auth.users limit 1;
      select (public.compter_zone_pays('${zones.metro}', (select user_id from public.organization_members where organization_id = '${org}' limit 1))->>'count_cp')
             || '|' ||
             (public.compter_zone_pays('${zones.metroMoinsLyon}', (select user_id from public.organization_members where organization_id = '${org}' limit 1))->>'count_cp')
             || '|' || (select count(*) from public.custom_geo_zone_codes where zone_id = '${zones.metroMoinsLyon}');
      rollback;`);
    const [national, moins, codes] = r.split('|').map(Number);
    expect(national).toBe(5957);  // C25 (E7) : 5 956 avant (29259 reçoit son premier carreau)
    expect(moins).toBeLessThan(national);
    expect(moins).toBeGreaterThan(national - 200);
    expect(codes).toBe(0);
  }, LONG);
});
