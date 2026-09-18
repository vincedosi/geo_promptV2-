/**
 * Invariants de la population exposée, rejoués CONTRE LA BASE.
 *
 * Complément indispensable de `tests/unit/risques/exposition-sql.test.ts` :
 * celui-là lit le SQL et attrape une régression au moment où elle est écrite ;
 * celui-ci interroge les données et attrape ce qu'aucune relecture ne voit —
 * un référentiel qui change, un import qui décale un compte, une colonne qui
 * se vide.
 *
 * ── LA BASE VISÉE ─────────────────────────────────────────────────────────
 *
 * `.env.development.local` en priorité, donc le stack LOCAL. Voir
 * `tests/integration/supabase-rpc.test.ts` : avant le 2026-09-18 ces tests
 * tapaient en production avec la clé `service_role`. L'ordre de ces deux
 * lignes EST le garde-fou.
 *
 * Les invariants sont structurels : ils tiennent quelle que soit la
 * volumétrie. Sur une base locale partielle les TOTAUX seront petits, mais les
 * égalités et les bornes doivent être vraies quand même.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envLocalDev = path.resolve(process.cwd(), '.env.development.local');
const envLocal = path.resolve(process.cwd(), '.env.local');
const envPath = fs.existsSync(envLocalDev) ? envLocalDev : envLocal;
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISPO = !!(URL && KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sb: any;

interface Ligne {
  cle: string;
  nom: string;
  exposee: number;
  n_sites: number;
  n_indicatifs: number;
  carreaux: number;
  pop_totale: number | null;
  surface_km2: number | null;
  part_pct: number | null;
  densite: number | null;
}

interface Agregat {
  calculable: boolean;
  total_exposee: number;
  total_sites: number;
  total_indicatifs: number;
  n_unites: number;
  carreaux_non_attribues: number;
  rayon_m: number;
  lignes: Ligne[];
}

beforeAll(() => {
  if (DISPO) sb = createClient(URL as string, KEY as string, { auth: { persistSession: false } });
});

async function agreger(params: Record<string, unknown>): Promise<Agregat> {
  const { data, error } = await sb.rpc('population_exposee_agregee', params);
  expect(error, `RPC en erreur : ${error?.message}`).toBeNull();
  return data as Agregat;
}

describe.skipIf(!DISPO)('population exposée — invariants sur la base', () => {
  const DIMENSIONS = ['region', 'departement'] as const;

  it.each(DIMENSIONS)('la somme des lignes égale le total (%s)', async (dimension) => {
    const a = await agreger({ p_dimension: dimension, p_cible: 'ind', p_limite: 7000 });
    expect(a.calculable).toBe(true);
    const somme = a.lignes.reduce((s, l) => s + Number(l.exposee), 0);
    // Un carreau appartient à UNE unité et l'arrondi est cumulatif : l'égalité
    // doit être EXACTE, pas approchée.
    expect(Math.round(somme)).toBe(Number(a.total_exposee));
  });

  it('région et département rendent EXACTEMENT le même total', async () => {
    // Faux avant l'audit du 2026-09-18 : 5 805 contre 5 804, parce que le
    // total était la somme de lignes déjà arrondies et dépendait donc du
    // nombre de lignes.
    const [r, d] = await Promise.all([
      agreger({ p_dimension: 'region', p_cible: 'ind' }),
      agreger({ p_dimension: 'departement', p_cible: 'ind' }),
    ]);
    expect(Number(r.total_exposee)).toBe(Number(d.total_exposee));
  });

  it('aucun carreau n’est perdu à l’attribution', async () => {
    for (const dimension of DIMENSIONS) {
      const a = await agreger({ p_dimension: dimension, p_cible: 'ind' });
      expect(a.carreaux_non_attribues, `dimension ${dimension}`).toBe(0);
    }
  });

  it('aucune ligne n’est aberrante', async () => {
    const a = await agreger({ p_dimension: 'departement', p_cible: 'ind', p_limite: 7000 });
    for (const l of a.lignes) {
      expect(Number(l.exposee), `${l.nom} : population négative`).toBeGreaterThanOrEqual(0);
      expect(l.n_indicatifs, `${l.nom} : plus d’indicatifs que de sites`).toBeLessThanOrEqual(l.n_sites);
      if (l.part_pct !== null) {
        expect(Number(l.part_pct), `${l.nom} : part > 100 %`).toBeLessThanOrEqual(100);
      }
      if (l.pop_totale !== null) {
        expect(
          Number(l.exposee),
          `${l.nom} : plus d’exposés que d’habitants`,
        ).toBeLessThanOrEqual(Number(l.pop_totale));
      }
    }
  });

  it('une sous-population reste inférieure à la population totale', async () => {
    const [tous, jeunes, pauvres] = await Promise.all([
      agreger({ p_dimension: 'departement', p_cible: 'ind' }),
      agreger({ p_dimension: 'departement', p_cible: 'ind_18_24' }),
      agreger({ p_dimension: 'departement', p_cible: 'men_pauv' }),
    ]);
    expect(Number(jeunes.total_exposee)).toBeLessThan(Number(tous.total_exposee));
    expect(Number(pauvres.total_exposee)).toBeLessThan(Number(tous.total_exposee));
  });

  it('les deux natures de zone se dédoublonnent quand on les combine', async () => {
    // Les sites se répartissent exactement entre les deux modes ; les zones,
    // elles, peuvent se recouvrir. La somme séparée doit donc être SUPÉRIEURE
    // OU ÉGALE au calcul combiné — c'est la preuve que l'union par carreau
    // fait son travail.
    const [tous, pprt, buffer] = await Promise.all([
      agreger({ p_dimension: 'departement', p_cible: 'ind' }),
      agreger({ p_dimension: 'departement', p_cible: 'ind', p_modes: ['pprt'] }),
      agreger({ p_dimension: 'departement', p_cible: 'ind', p_modes: ['buffer'] }),
    ]);
    expect(Number(pprt.total_exposee) + Number(buffer.total_exposee))
      .toBeGreaterThanOrEqual(Number(tous.total_exposee));
    expect(pprt.total_sites + buffer.total_sites).toBe(tous.total_sites);
  });

  it('un périmètre d’étude ne peut que RÉDUIRE le résultat', async () => {
    const france = await agreger({ p_dimension: 'departement', p_cible: 'ind' });
    const uneRegion = await agreger({
      p_dimension: 'departement', p_cible: 'ind',
      p_perim_niveau: 'region', p_perim_codes: ['76'],
    });
    expect(Number(uneRegion.total_exposee)).toBeLessThanOrEqual(Number(france.total_exposee));
    expect(uneRegion.n_unites).toBeLessThanOrEqual(france.n_unites);
  });

  it('une cible inconnue est refusée, pas calculée au hasard', async () => {
    const { data } = await sb.rpc('population_exposee_agregee', {
      p_dimension: 'departement',
      p_cible: 'colonne_qui_n_existe_pas',
    });
    expect((data as { calculable: boolean; error?: string }).calculable).toBe(false);
    expect((data as { error?: string }).error).toBe('cible_inconnue');
  });

  it('le rayon par défaut est déduit des périmètres, pas figé', async () => {
    const { data, error } = await sb.rpc('rayon_defaut_exposition');
    expect(error).toBeNull();
    // 532 m mesurés le 2026-09-18. La borne est large : ce qui compte est que
    // la valeur vienne des données et reste dans un ordre de grandeur sensé.
    expect(Number(data)).toBeGreaterThan(100);
    expect(Number(data)).toBeLessThan(5000);
  });
});

describe.skipIf(!DISPO)('population exposée — les référentiels sous-jacents', () => {
  it('le dénominateur retenu colle au chiffre INSEE', async () => {
    // 67 760 552 habitants : l'invariant que le projet valide déjà ailleurs
    // (`qualite_invariants`, sql/149). Si `iris_agg_departement` dérive, la
    // colonne « Part » dérive avec lui — silencieusement.
    const { data, error } = await sb.from('iris_agg_departement').select('population');
    expect(error).toBeNull();
    const total = (data as Array<{ population: number | null }>)
      .reduce((s, r) => s + Number(r.population ?? 0), 0);
    // 1 % de tolérance : un import IRIS peut bouger à la marge, pas de 10 %.
    expect(Math.abs(total - 67_760_552) / 67_760_552).toBeLessThan(0.01);
  });

  it('les colonnes qui MENTENT sont toujours vides — si elles se remplissent, on veut le savoir', async () => {
    // `ind` et `geom_centroid` de `carreaux_filosofi` sont NULL sur les
    // 2 298 582 lignes. Le code ne les lit plus. Le jour où un import les
    // remplit, ce test rougit : ce n'est pas un bug, c'est une invitation à
    // simplifier le calcul — et à vérifier qu'il n'existe pas deux sources.
    const { data, error } = await sb
      .from('carreaux_filosofi')
      .select('ind, geom_centroid')
      .not('ind', 'is', null)
      .limit(1);
    expect(error).toBeNull();
    expect(
      (data as unknown[]).length,
      'La colonne `ind` se remplit : revoir sql/185+ et docs/SEVESO_PPRT.md',
    ).toBe(0);
  });
});
