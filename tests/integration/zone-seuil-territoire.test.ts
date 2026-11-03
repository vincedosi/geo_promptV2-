/**
 * Seuil d'indicateur au territoire (IRIS ou CP), borné par le périmètre de ① (spec § 16.3). Même dérivation de la
 * valeur que get_indicator_threshold_selection (sql/100) ; mesuré le 2026-10-14 : taux de pauvreté ≥ 20 % sur ARA,
 * 472 IRIS, 0,55 s.
 *
 * Les quatre sources du registre ont chacune leur cas : iris_column, abstention, pollen, atmo. Pollen et atmo ne
 * portent en local que 100 codes postaux à leur dernière date (Ain et Aisne, mesuré le 2026-10-15) : leur cas se
 * calcule sur la région 84, qui contient l'Ain.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_seuil_territoire', {
  p_indicateur: 'taux_pauvrete', p_operateur: '>=', p_seuil: 20, p_perimetre_type: 'region', p_perimetre_code: '84',
  p_org_id: null, p_max_territoires: 5000, ...args,
});

type Zone = { vide: boolean; compte: number; maille: string; geometry: { type: string } | null; surface_km2: number };

describe('zone_seuil_territoire', () => {
  it('IRIS : taux de pauvreté ≥ 20 % en ARA', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    expect(data).toMatchObject({ vide: false, maille: 'iris' });
    const z = data as Zone;
    expect(z.compte).toBeGreaterThan(100);
    expect(z.geometry?.type).toBe('MultiPolygon');
    expect(z.surface_km2).toBeGreaterThan(0);
  });

  it('IRIS par département et par commune : un sous-ensemble de la région', async () => {
    const region = (await appeler({})).data as Zone;
    const dept = (await appeler({ p_perimetre_type: 'departement', p_perimetre_code: '69' })).data as Zone;
    // « lyon » tapé dans ① = l'union de ses 9 arrondissements (resoudre_perimetre), filtrée par la géométrie
    const commune = (await appeler({ p_perimetre_type: 'commune', p_perimetre_code: 'lyon' })).data as Zone;
    expect(dept.compte).toBeLessThan(region.compte);
    expect(commune.compte).toBeGreaterThan(0);
    expect(commune.compte).toBeLessThan(dept.compte);
    expect(commune.maille).toBe('iris');
  });

  it('CP : abstention 2022 dans les Bouches-du-Rhône', async () => {
    const { data, error } = await appeler({ p_indicateur: 'abstention_pres_2022', p_seuil: 25, p_perimetre_type: 'departement', p_perimetre_code: '13' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ vide: false, maille: 'cp' });
    expect((data as Zone).compte).toBeGreaterThan(0);
  });

  it.each([
    ['pollen', 'pollen_indice', 1],
    ['atmo', 'atmo_indice', 1],
  ])('CP : %s, dernière date, région 84', async (_n, indicateur, seuil) => {
    const { data, error } = await appeler({ p_indicateur: indicateur, p_seuil: seuil });
    expect(error).toBeNull();
    expect(data).toMatchObject({ vide: false, maille: 'cp' });
    const z = data as Zone;
    expect(z.compte).toBeGreaterThan(0);
    // 100 codes postaux à la dernière date, dont 60 dans l'Ain : la date est bien filtrée
    expect(z.compte).toBeLessThanOrEqual(60);
  });

  it('D30 : les communes non découpées entrent comme « commune entière » quand l’indicateur a une valeur (densité)', async () => {
    // Mesuré le 03/11 : région 84, densité ≥ 100 → 2 571 unités dont 1 041 communes entières (2 274 527 hab.) ;
    // 12 unités sans densité, non évaluables. Ain, densité ≥ 0 → 73 vrais IRIS + 374 communes entières (C19 : 73).
    const { data, error } = await appeler({ p_indicateur: 'densite_pop', p_seuil: 100 });
    expect(error).toBeNull();
    const z = data as Zone & { codes: string[]; communes_entieres: number; non_evaluables: number };
    expect(z).toMatchObject({ vide: false, maille: 'iris', compte: 2571, communes_entieres: 1041, non_evaluables: 12 });
    expect(z.codes.filter((c) => c.endsWith('0000'))).toHaveLength(1041);
    const ain = (await appeler({ p_indicateur: 'densite_pop', p_seuil: 0, p_perimetre_type: 'departement', p_perimetre_code: '01' })).data as typeof z;
    expect(ain).toMatchObject({ compte: 447, communes_entieres: 374, non_evaluables: 1 });
  });

  it('D30 : indicateur sans valeur sur les communes entières (taux de pauvreté) — non évaluables, jamais retenues', async () => {
    // Région 84 : 3 812 communes entières sans taux de pauvreté + 147 vrais IRIS sans valeur = 3 959 non évaluables.
    const z = (await appeler({})).data as Zone & { codes: string[]; communes_entieres: number; non_evaluables: number };
    expect(z).toMatchObject({ compte: 472, communes_entieres: 0, non_evaluables: 3959 });
    expect(z.codes.filter((c) => c.endsWith('0000'))).toEqual([]);
    // « ≤ » ne les rattrape pas non plus : une valeur absente n'est pas 0.
    const inf = (await appeler({ p_operateur: '<=', p_seuil: 1000 })).data as typeof z;
    expect(inf).toMatchObject({ communes_entieres: 0, non_evaluables: 3959 });
    expect(inf.compte).toBe(1601 - 147);
  });

  it('D30 : la région 84 entière (≥ 0) dépasse désormais le plafond de 5 000 unités', async () => {
    expect((await appeler({ p_indicateur: 'densite_pop', p_seuil: 0 })).data).toEqual({ refus: 'trop_de_territoires', plafond: 5000 });
  });

  it('aucun territoire au-dessus du seuil : vide, sans géométrie', async () => {
    // B15 (sql/320) : `codes`, les unités constitutives — vide ici.
    expect((await appeler({ p_seuil: 1000 })).data).toEqual({
      vide: true, compte: 0, maille: 'iris', codes: [], geometry: null, surface_km2: 0, communes_entieres: 0, non_evaluables: 3959,
    });
  });

  it.each([
    ['France', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, { refus: 'perimetre_national_refuse' }],
    ['indicateur inconnu', { p_indicateur: 'pas_un_indicateur' }, { refus: 'indicateur_inconnu' }],
    ['plafond dépassé', { p_seuil: 0, p_max_territoires: 5 }, { refus: 'trop_de_territoires', plafond: 5 }],
    ['plafond dépassé, CP', { p_indicateur: 'abstention_pres_2022', p_seuil: 0, p_perimetre_type: 'departement', p_perimetre_code: '13', p_max_territoires: 5 }, { refus: 'trop_de_territoires', plafond: 5 }],
  ])('%s : refus', async (_n, args, attendu) => {
    expect((await appeler(args)).data).toEqual(attendu);
  });

  it.each([
    ['opérateur inconnu', { p_operateur: '>' }],
    ['plafond au-delà de 5 000', { p_max_territoires: 5001 }],
  ])('%s : 22023', async (_n, args) => {
    expect((await appeler(args)).error?.code).toBe('22023');
  });
});
