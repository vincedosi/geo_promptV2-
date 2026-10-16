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

  it('aucun territoire au-dessus du seuil : vide, sans géométrie', async () => {
    expect((await appeler({ p_seuil: 1000 })).data).toEqual({ vide: true, compte: 0, maille: 'iris', geometry: null, surface_km2: 0 });
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
