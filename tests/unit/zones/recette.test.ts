import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CAPACITE_SYNCHRONE_POI_RAYON, INDICATEURS_SEUIL_CARREAUX, MAX_CARREAUX_SEUIL, MAX_POI_RAYON, MAX_TERRITOIRES_SEUIL, MESSAGES_REFUS, PERIMETRES_ADMIS,
  RAYON_POI_MAX_M, RAYON_POI_MIN_M, SURFACE_MAX_PERIMETRE_CARREAUX_KM2, SURFACE_MAX_PERIMETRE_KM2,
  TYPES_BORNES_PAR_PERIMETRE, TYPES_RECALCULABLES, TYPES_RECETTE, VERSION_RECETTE, estRecalculable, exigeGeometrie,
  exigePerimetre, libelleRecette, refusPerimetreLocal, type Recette,
} from '@/lib/zones/recette';
import { formaterNombre } from '@/lib/format/nombre';
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

  it('recalculable : rayon, rayon POI, seuils, CP — pas les formes figées, ni la combinaison', () => {
    const r = (type: string) => ({ v: 1, type } as unknown as Recette);
    expect(TYPES_RECALCULABLES).toEqual(['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux']);
    expect(TYPES_RECALCULABLES.every((t) => estRecalculable(r(t)))).toBe(true);
    // Arbitrage de la revue finale du lot 3 : une combinaison a des opérandes figés, la rejouer rend la même forme.
    expect(['dessin', 'import', 'isochrone', 'capture', 'combinaison'].some((t) => estRecalculable(r(t)))).toBe(false);
  });

  it('la géométrie vient du client pour les quatre formes figées seulement ; la combinaison est calculée par le serveur', () => {
    const r = (type: string) => ({ v: 1, type } as unknown as Recette);
    expect(TYPES_RECETTE.filter((t) => exigeGeometrie(r(t)))).toEqual(['dessin', 'import', 'isochrone', 'capture']);
  });

  it('le refus de recalcul dit les deux cas : forme figée (combinaison comprise) et zone citée', () => {
    expect(MESSAGES_REFUS.forme_figee).toContain('combinaison');
    expect(MESSAGES_REFUS.zone_referencee)
      .toBe('Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être recalculée.');
  });

  it('les recettes bornées par le périmètre sont exactement celles de PERIMETRES_ADMIS', () => {
    expect([...TYPES_BORNES_PAR_PERIMETRE].sort()).toEqual(Object.keys(PERIMETRES_ADMIS).sort());
  });

  it('VERSION_RECETTE est la version du CHECK de la migration', () => {
    expect(migration(/_zones_a_recette\.sql$/)).toContain(`recette->>'v' = '${VERSION_RECETTE}'`);
  });

  /** Le premier nombre capturé par `re` dans la migration de suffixe donné. */
  function litteral(suffixe: RegExp, re: RegExp): number {
    const sql = migration(suffixe);
    expect(sql, `migration ${suffixe}`).toBeDefined();
    const m = re.exec(sql!);
    expect(m, `${re} dans ${suffixe}`).not.toBeNull();
    return Number(m![1]);
  }

  it('les plafonds de recette.ts sont les littéraux écrits dans les RPC (sql/254-256)', () => {
    const SURFACE = /resoudre_perimetre\(p_perimetre_type, p_perimetre_code, p_org_id, (\d+),/;
    const POI = /_zone_rayon_poi\.sql$/;
    const CARREAUX = /_zone_seuil_carreaux\.sql$/;
    const TERRITOIRES = /_zone_seuil_territoire\.sql$/;
    expect(litteral(POI, SURFACE)).toBe(SURFACE_MAX_PERIMETRE_KM2);
    expect(litteral(TERRITOIRES, SURFACE)).toBe(SURFACE_MAX_PERIMETRE_KM2);
    expect(litteral(CARREAUX, SURFACE)).toBe(SURFACE_MAX_PERIMETRE_CARREAUX_KM2);
    expect(litteral(POI, /p_rayon_m < (\d+) or/)).toBe(RAYON_POI_MIN_M);
    expect(litteral(POI, /p_rayon_m > (\d+) then/)).toBe(RAYON_POI_MAX_M);
    expect(litteral(POI, /p_max_poi integer default (\d+)/)).toBe(MAX_POI_RAYON);
    expect(litteral(POI, /p_max_poi > (\d+) then/)).toBe(MAX_POI_RAYON);
    expect(litteral(CARREAUX, /p_max_carreaux integer default (\d+)/)).toBe(MAX_CARREAUX_SEUIL);
    expect(litteral(CARREAUX, /p_max_carreaux > (\d+) then/)).toBe(MAX_CARREAUX_SEUIL);
    expect(litteral(TERRITOIRES, /p_max_territoires integer default (\d+)/)).toBe(MAX_TERRITOIRES_SEUIL);
    expect(litteral(TERRITOIRES, /p_max_territoires > (\d+) then/)).toBe(MAX_TERRITOIRES_SEUIL);
  });

  it('les recettes lourdes exigent un périmètre et refusent la France', () => {
    const lourde: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'france', code: 'FR' } };
    expect(exigePerimetre(lourde)).toBe(true);
    expect(refusPerimetreLocal(lourde)).toBe('perimetre_national_refuse');
    expect(refusPerimetreLocal({ ...lourde, perimetre: null })).toBe('perimetre_absent');
    expect(refusPerimetreLocal({ ...lourde, perimetre: PER })).toBeNull();
    expect(refusPerimetreLocal({ v: 1, type: 'codes_postaux', codes: ['13001'] })).toBeNull();
  });

  it('France métropolitaine (retours du 26/10) : « Autour des POI » passe, les seuils sont différés ; la France entière reste refusée', () => {
    const METRO = { type: 'france', code: 'METRO' } as const;
    const FR = { type: 'france', code: 'FR' } as const;
    const rayon = (perimetre: typeof METRO | typeof FR): Recette => ({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 20_000, perimetre });
    const carreaux = (perimetre: typeof METRO | typeof FR): Recette => ({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre });
    const territoire = (perimetre: typeof METRO | typeof FR): Recette => ({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre });
    expect(refusPerimetreLocal(rayon(METRO))).toBeNull();
    expect(refusPerimetreLocal(carreaux(METRO))).toBe('seuil_metropole_differe');
    expect(refusPerimetreLocal(territoire(METRO))).toBe('seuil_metropole_differe');
    for (const r of [rayon(FR), carreaux(FR), territoire(FR)]) expect(refusPerimetreLocal(r)).toBe('perimetre_national_refuse');
  });

  it('les messages de la métropole : la tâche de fond pour le rayon, le calcul différé pour le seuil', () => {
    expect(CAPACITE_SYNCHRONE_POI_RAYON).toBe(10_000);
    expect(MESSAGES_REFUS.trop_de_poi_metropole).toBe(
      `Plus de ${formaterNombre(10_000)} POI dans toute la France métropolitaine : ce calcul dépasse ce qu’on peut calculer en direct. `
      + 'Il se lancera en tâche de fond dès le lot « calculs longs » ; en attendant, choisissez une région ou un département à l’étape ①.');
    expect(MESSAGES_REFUS.seuil_metropole_differe).toBe(
      'Le seuil sur toute la France métropolitaine arrive bientôt, en calcul de fond. En attendant, choisissez à l’étape ① '
      + 'un département (carreaux) ou une région (territoires).');
  });

  it('la capacité de la métropole est le littéral écrit dans sql/285, qui garde la liste et la surface de sql/254', () => {
    const METROPOLE = /_zone_rayon_poi_metropole\.sql$/;
    expect(litteral(METROPOLE, /least\(p_max_poi, (\d+)\)/)).toBe(CAPACITE_SYNCHRONE_POI_RAYON);
    expect(litteral(METROPOLE, /when v_metro then (\d+) else/)).toBe(CAPACITE_SYNCHRONE_POI_RAYON);
    expect(litteral(METROPOLE, /when v_metro then \d+ else (\d+) end\)/)).toBe(MAX_POI_RAYON);
    expect(litteral(METROPOLE, /resoudre_perimetre\(p_perimetre_type, p_perimetre_code, p_org_id, (\d+),/)).toBe(SURFACE_MAX_PERIMETRE_KM2);
    expect(migration(METROPOLE)).toContain(liste('rayon_poi'));
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

  it('le seuil est mis en forme par formaterNombre (milliers séparés, virgule décimale)', () => {
    expect(libelleRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'densite_ind', operateur: '>=', seuil: 20000, perimetre: PER }))
      .toBe(`Carreaux où densité d’habitants ≥ ${formaterNombre(20000)} hab./km²`);
    expect(formaterNombre(20000)).not.toBe('20000');
    expect(libelleRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '<=', seuil: 12.5, perimetre: PER }))
      .toBe('Carreaux où part des ménages pauvres ≤ 12,5 %');
  });

  it('seuil sur territoires : le libellé et l’unité du catalogue quand il est fourni, l’identifiant sinon', () => {
    const CATALOGUE = [
      { indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', unit: '%' },
      { indicator_code: 'nb_menages', label: 'Ménages', unit: null },
    ];
    const r = { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20.5, perimetre: null } as const;
    expect(libelleRecette(r, CATALOGUE)).toBe('Territoires où taux de pauvreté ≥ 20,5 %');
    expect(libelleRecette({ ...r, indicateur: 'nb_menages', operateur: '<=', seuil: 15000 }, CATALOGUE))
      .toBe(`Territoires où ménages ≤ ${formaterNombre(15000)}`);
    expect(libelleRecette({ ...r, seuil: 20 }, [])).toBe('Territoires où taux_pauvrete ≥ 20');
    expect(libelleRecette({ ...r, seuil: 20 })).toBe('Territoires où taux_pauvrete ≥ 20');
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

  it('un périmètre « france » ne porte que FR ou METRO', () => {
    const avec = (code: string) => lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'france', code } }).ok;
    expect(avec('FR')).toBe(true);
    expect(avec('METRO')).toBe(true);
    expect(avec('XX')).toBe(false);
    expect(avec('metro')).toBe(false);
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
