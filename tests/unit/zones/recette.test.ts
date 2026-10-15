import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  INDICATEURS_SEUIL_CARREAUX, MESSAGES_REFUS, PERIMETRES_ADMIS, TYPES_RECETTE, estRecalculable, exigePerimetre,
  libelleRecette, refusPerimetreLocal, type Recette,
} from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const PER = { type: 'departement', code: '13' } as const;

/** La migration qui porte ce suffixe, cherchée par suffixe et jamais par numéro (le numéro réel se prend à chaque tâche). */
function migration(suffixe: RegExp): string | undefined {
  const f = readdirSync('sql').find((n) => suffixe.test(n));
  return f ? readFileSync(`sql/${f}`, 'utf8') : undefined;
}

describe('la recette d’une zone', () => {
  it('dix types, et le CHECK de la migration les liste tous', () => {
    expect(TYPES_RECETTE).toHaveLength(10);
    const sql = migration(/_zones_a_recette\.sql$/);
    expect(sql, 'migration *_zones_a_recette.sql').toBeDefined();
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

  const liste = (type: 'rayon_poi' | 'seuil_carreaux' | 'seuil_territoire') =>
    `array[${(PERIMETRES_ADMIS[type] ?? []).map((t) => `'${t}'`).join(', ')}]`;

  it('PERIMETRES_ADMIS est la liste écrite dans les RPC du rayon POI et du seuil sur carreaux', () => {
    for (const [type, suffixe] of [
      ['rayon_poi', /_zone_rayon_poi\.sql$/],
      ['seuil_carreaux', /_zone_seuil_carreaux\.sql$/],
    ] as const) {
      const sql = migration(suffixe);
      expect(sql, `migration ${suffixe}`).toBeDefined();
      expect(sql, type).toContain(liste(type));
    }
  });

  it('PERIMETRES_ADMIS est la liste écrite dans la RPC du seuil sur territoires (Task 6)', () => {
    const sql = migration(/_zone_seuil_territoire\.sql$/);
    expect(sql, 'migration *_zone_seuil_territoire.sql').toBeDefined();
    expect(sql).toContain(liste('seuil_territoire'));
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

// Les refus de lireRecette, les combinaisons et l'intersection sont couverts par recette-schema.test.ts (revue de la
// Task 2) ; seul le cas d'une recette lourde COMPLÈTE acceptée n'y figure pas, il reste ici.
describe('lireRecette (Zod)', () => {
  it('accepte une recette complète', () => {
    expect(lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER }).ok).toBe(true);
  });

  // `zone_referencee` compare des UUID en texte jsonb : un UUID en majuscules lui échapperait (revue de la Task 3).
  it('range tout UUID en minuscules : zones d’une combinaison et périmètre « zone »', () => {
    const A = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';
    const B = '3F2504E0-4F89-11D3-9A0C-0305E82C3302';
    const c = lireRecette({ v: 1, type: 'combinaison', operation: 'union', zones: [A, B] });
    expect(c.ok && c.recette.type === 'combinaison' && c.recette.zones).toEqual([A.toLowerCase(), B.toLowerCase()]);
    const p = lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'zone', code: A } });
    expect(p.ok && p.recette.type === 'rayon_poi' && p.recette.perimetre).toEqual({ type: 'zone', code: A.toLowerCase() });
    // Un code de commune n'est PAS touché (`2a004` est résolu en base).
    const q = lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'commune', code: 'Martigues' } });
    expect(q.ok && q.recette.type === 'rayon_poi' && q.recette.perimetre).toEqual({ type: 'commune', code: 'Martigues' });
    // Le même UUID en deux casses est un doublon.
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'union', zones: [A, A.toLowerCase()] }).ok).toBe(false);
  });
});
