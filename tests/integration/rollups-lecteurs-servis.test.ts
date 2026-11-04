/**
 * Relecture de la phase 2, I2 — les lecteurs de `campaign_cp_rollup` quand le réglage `tableaux_depuis_plan` est
 * allumé (sql/346), après sql/349 (`campaign_cp_rollup.servi`).
 *
 * Cas « strict » de la fixture partagée (tâche 2.1) : 75001 et 75002 servis, 99999 livré hors plan, 75003 et 13001 au
 * plan JAMAIS servis (deux lignes `servi = false` avec `true`). Tout dans UNE transaction ANNULÉE (base partagée).
 *
 * Deux familles, décidées lecteur par lecteur (audit : `phase2-correctifs-report.md`) :
 *  - ceux qui DÉCRIVENT la livraison rendent la MÊME chose avec ou sans le réglage : `compte_cp_campagne` (pré-vol,
 *    corrélation), `correlation_campagne_indicateur`, `simulate_dsp_report`, `get_campaign_reconciliation_map` ;
 *  - ceux qui MESURENT contre le plan voient les 2 codes non servis de plus : `calculer_alignement_geo` (`n_cp`),
 *    `alignement_par_maille` (maille CP), `alignement_dispersion_cp`, `get_campaign_suivi_map`, `pression_par_classe`.
 */
import { describe, it, expect } from 'vitest';
import { psql } from './_psql';
import { CAS, lit, semer } from './_tableau-depuis-plan';

const STRICT = CAS.find((c) => c.nom === 'strict')!;
const C = lit(STRICT.campagne);

function mesurer(dp: boolean): string[] {
  const k = (n: string) => `'${n}:${dp}'`;
  return [
    `select public.refresh_campaign_rollups_depuis_plan(${C}, ${dp});`,
    // Décrivent la livraison.
    `insert into r select ${k('compte')}, to_jsonb(public.compte_cp_campagne(${C}));`,
    `insert into r select ${k('correlation')}, public.correlation_campagne_indicateur(${C}, (select indicator_code from indicator_cp_values where postal_code = '75001' limit 1));`,
    `insert into r select ${k('simulate')}, public.simulate_dsp_report(${C});`,
    `insert into r select ${k('rapport_cp')}, coalesce(jsonb_agg(postal_code order by postal_code), '[]') from campaign_dsp_report where campaign_id = ${C} and date is null and source = 'simulated';`,
    // Un rapport DSP RÉEL sur un code jamais servi (75003) : la réconciliation ne doit pas le comparer à une « mesure »
    // inventée par le réglage.
    `insert into campaign_dsp_report (campaign_id, date, channel, postal_code, impressions, spend, source) values (${C}, null, '', '75003', 100, 1, 'api');`,
    `insert into r select ${k('reconciliation')}, coalesce((select jsonb_agg(e->>'code' order by e->>'code') from json_array_elements(public.get_campaign_reconciliation_map(${C})) e), '[]');`,
    `delete from campaign_dsp_report where campaign_id = ${C} and source = 'api';`,
    // Mesurent contre le plan.
    `insert into r select ${k('score')}, public.calculer_alignement_geo(${C}, 10, 1.0) -> 'n_cp';`,
    `insert into r select ${k('maille')}, public.alignement_par_maille(${C}, 'cp') -> 'n_total';`,
    `insert into r select ${k('dispersion')}, (select to_jsonb(sum((t->>'n_cp')::int)) from jsonb_array_elements(public.alignement_dispersion_cp(${C}) -> 'tranches') t);`,
    `insert into r select ${k('carte')}, to_jsonb(json_array_length(public.get_campaign_suivi_map(${C})));`,
    `insert into r select ${k('classes')}, public.pression_par_classe(${C}, (select id from zone_sets order by id limit 1)) -> 'n_cp';`,
  ];
}

function rejouer(): Record<string, unknown> {
  const etapes = [
    'begin;',
    'create temp table r (cle text, v jsonb) on commit drop;',
    semer(STRICT),
    `update dsp_campaigns set geo_strategy = '{"channels": {"dsps": ["dv360", "ttd"]}}'::jsonb where id = ${C};`,
    ...mesurer(false),
    ...mesurer(true),
    `insert into r select 'non_servis', to_jsonb((select count(*) from campaign_cp_rollup where campaign_id = ${C} and not servi));`,
    'select jsonb_object_agg(cle, v)::text from r;',
    'rollback;',
  ];
  return JSON.parse(psql(etapes.join('\n')));
}

const R = rejouer();

describe('lecteurs de campaign_cp_rollup avec tableaux_depuis_plan (sql/349)', () => {
  it('true ajoute exactement les 2 codes jamais servis, marqués servi = false', () => {
    expect(R.non_servis).toBe(2);
  });

  it.each(['compte', 'correlation', 'simulate', 'rapport_cp', 'reconciliation'])(
    '%s décrit la livraison : identique avec ou sans le réglage', (cle) => {
      expect(R[`${cle}:true`]).toEqual(R[`${cle}:false`]);
    });

  it('compte_cp_campagne : 3 codes livrés (75001, 75002, 99999), jamais les codes du plan non servis', () => {
    expect(R['compte:true']).toBe(3);
  });

  it('réconciliation : le rapport réel sur 75003 (jamais servi) n est pas comparé à une mesure à 0', () => {
    expect(R['reconciliation:true']).not.toContain('75003');
  });

  it.each(['score', 'maille', 'dispersion', 'carte', 'classes'])(
    '%s mesure contre le plan : les 2 codes non servis comptent', (cle) => {
      expect(Number(R[`${cle}:true`])).toBe(Number(R[`${cle}:false`]) + 2);
    });
});
