import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  INDICATEURS_SEUIL_CARREAUX, MESSAGES_REFUS, PERIMETRES_ADMIS, TYPES_RECETTE, estRecalculable, exigePerimetre,
  libelleRecette, refusPerimetreLocal, type Recette,
} from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const PER = { type: 'departement', code: '13' } as const;
const UUID_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
const UUID_C = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';

/** La migration qui porte ce suffixe, cherchée par suffixe et jamais par numéro (le numéro réel se prend à chaque tâche). */
function migration(suffixe: RegExp): string | undefined {
  const f = readdirSync('sql').find((n) => suffixe.test(n));
  return f ? readFileSync(`sql/${f}`, 'utf8') : undefined;
}

describe('la recette d’une zone', () => {
  it('dix types, et le CHECK de la migration les liste tous', () => {
    expect(TYPES_RECETTE).toHaveLength(10);
    const sql = migration(/_zones_a_recette\.sql$/);
    if (sql === undefined) return; // la migration arrive en Task 3 : retirer CETTE ligne la rend stricte
    for (const t of TYPES_RECETTE) expect(sql, t).toContain(`'${t}'`);
  });

  it('recalculable : rayon, rayon POI, seuils, CP, combinaison — pas les formes figées', () => {
    const r = (type: string) => ({ v: 1, type } as unknown as Recette);
    expect(['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux', 'combinaison'].every((t) => estRecalculable(r(t)))).toBe(true);
    expect(['dessin', 'import', 'isochrone', 'capture'].some((t) => estRecalculable(r(t)))).toBe(false);
  });

  it('les recettes lourdes exigent un périmètre et refusent la France', () => {
    const lourde: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'france', code: 'FR' } };
    expect(exigePerimetre(lourde)).toBe(true);
    expect(refusPerimetreLocal(lourde)).toBe('perimetre_national_refuse');
    expect(refusPerimetreLocal({ ...lourde, perimetre: null })).toBe('perimetre_absent');
    expect(refusPerimetreLocal({ ...lourde, perimetre: PER })).toBeNull();
    expect(refusPerimetreLocal({ v: 1, type: 'codes_postaux', codes: ['13001'] })).toBeNull();
  });

  it('le seuil sur carreaux s’arrête au département ; les deux autres admettent la région', () => {
    const region = { type: 'region', code: '84' } as const;
    expect(refusPerimetreLocal({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: region })).toBe('perimetre_non_admis');
    expect(refusPerimetreLocal({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'commune', code: 'marseille' } })).toBeNull();
    expect(refusPerimetreLocal({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: region })).toBeNull();
    expect(refusPerimetreLocal({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: region })).toBeNull();
  });

  it('PERIMETRES_ADMIS est la liste écrite dans la RPC du seuil sur carreaux', () => {
    const sql = migration(/_zone_seuil_carreaux\.sql$/);
    if (sql === undefined) return; // la migration arrive en Task 5 : retirer CETTE ligne la rend stricte
    expect(sql).toContain(`array[${PERIMETRES_ADMIS.seuil_carreaux!.map((t) => `'${t}'`).join(', ')}]`);
  });

  it('un message français pour chaque refus', () => {
    for (const [cle, m] of Object.entries(MESSAGES_REFUS)) expect(m.length, cle).toBeGreaterThan(10);
    expect(MESSAGES_REFUS.commune_ambigue).toContain('code INSEE');
  });

  it('libellé d’une ligne, en sentence case', () => {
    expect(libelleRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER })).toBe('Rayon de 5 km autour des POI « lycee »');
    expect(libelleRecette({ v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 1500 })).toBe('Rayon de 1,5 km autour d’un point');
    expect(libelleRecette({ v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 300 })).toBe('Rayon de 300 m autour d’un point');
    expect(libelleRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: PER }))
      .toBe('Carreaux où part des ménages pauvres ≥ 40 %');
    expect(libelleRecette({ v: 1, type: 'combinaison', operation: 'difference', zones: ['a', 'b', 'c'] })).toBe('Différence de 3 zones');
    expect(libelleRecette({ v: 1, type: 'codes_postaux', codes: ['13001'] })).toBe('1 code postal');
    expect(libelleRecette({ v: 1, type: 'codes_postaux', codes: ['13001', '13002'] })).toBe('2 codes postaux');
  });

  it('13 indicateurs de seuil sur carreaux, ids uniques', () => {
    expect(INDICATEURS_SEUIL_CARREAUX).toHaveLength(13);
    expect(new Set(INDICATEURS_SEUIL_CARREAUX.map((i) => i.id)).size).toBe(13);
  });
});

describe('lireRecette (Zod)', () => {
  it('accepte une recette complète', () => {
    expect(lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER }).ok).toBe(true);
  });
  it('accepte une union de trois zones, une différence de deux, une intersection de deux', () => {
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A, UUID_B, UUID_C] }).ok).toBe(true);
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'difference', zones: [UUID_A, UUID_B] }).ok).toBe(true);
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'intersection', zones: [UUID_A, UUID_B] }).ok).toBe(true);
  });
  it('l’intersection se fait entre deux zones exactement, et le dit', () => {
    const r = lireRecette({ v: 1, type: 'combinaison', operation: 'intersection', zones: [UUID_A, UUID_B, UUID_C] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('L’intersection se fait entre deux zones.');
  });
  it.each([
    ['version inconnue', { v: 2, type: 'dessin' }],
    ['type inconnu', { v: 1, type: 'pluie' }],
    ['rayon trop grand', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 60_000, perimetre: PER }],
    ['indicateur hors liste', { v: 1, type: 'seuil_carreaux', indicateur: 'men', operateur: '>=', seuil: 1, perimetre: PER }],
    ['opérateur', { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>', seuil: 1, perimetre: PER }],
    ['combinaison d’une seule zone', { v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A] }],
    ['périmètre zone non UUID', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'zone', code: 'abc' } }],
    ['clé en trop', { v: 1, type: 'dessin', geometrie: {} }],
  ])('refuse : %s, avec un message français', (_n, v) => {
    const r = lireRecette(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Recette/);
  });
});
