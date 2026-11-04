/**
 * Tâche 2.1 de l'optimisation Python — `refresh_campaign_rollups_depuis_plan` (sql/346), jumelle de
 * `refresh_campaign_rollups` : tableaux par code postal construits DEPUIS LE PLAN (0 si non servi).
 *
 * Les cas construits sont ceux de `services/optimisation/tests/parite/fixtures/tableau-depuis-plan.json`, que pytest
 * rejoue côté Python (`test_tableau_depuis_plan.py`) : le SQL et le Python sont ainsi tenus aux MÊMES sorties.
 * Tout est écrit dans UNE transaction ANNULÉE (base locale partagée) : campagnes, stratégies, plans, livraisons.
 *
 * Vérifié :
 *  - `false` rend le rollup d'avant ; `true` y ajoute les codes du plan jamais servis (acteur '', tout à 0) ;
 *  - l'enveloppe `refresh_campaign_rollups` suit le réglage `optimisation_reglages.parametres.tableaux_depuis_plan`
 *    (sql/345) : sans réglage, comme avant ; réglée à `true`, comme la jumelle ;
 *  - l'effet sur les mesures SQL du cas strict : score 61 → 17, « 1 CP cibles sous 70 % » → « 3 CP ».
 */
import { describe, it, expect } from 'vitest';
import { psql } from './_psql';
import { CAS, ESPACE, lit, semer, type Cas } from './_tableau-depuis-plan';

const lignes = (c: Cas) => `(select coalesce(jsonb_agg(jsonb_build_array(postal_code, actor, dept, impressions, spend::text,
  imps_7d, imps_prev7d, in_target, planned_share::text) order by postal_code collate "C", actor collate "C"), '[]')
  from campaign_cp_rollup where campaign_id = ${lit(c.campagne)})`;

/** Rejoue tous les cas dans une transaction annulée ; rend un objet JSON par étape. */
function rejouer(): Record<string, unknown> {
  const etapes: string[] = ['begin;', 'create temp table r (cle text, v jsonb) on commit drop;'];
  for (const c of CAS) {
    etapes.push(semer(c));
    for (const dp of [false, true]) {
      etapes.push(`insert into r select '${c.nom}:${dp}:retour', public.refresh_campaign_rollups_depuis_plan(${lit(c.campagne)}, ${dp});`);
      etapes.push(`insert into r select '${c.nom}:${dp}:lignes', ${lignes(c)};`);
      etapes.push(`insert into r select '${c.nom}:${dp}:score', public.calculer_alignement_geo(${lit(c.campagne)}, 10, 1.0);`);
    }
    // L'enveloppe, sans réglage puis réglée.
    etapes.push(`insert into r select '${c.nom}:enveloppe_sans_reglage', public.refresh_campaign_rollups(${lit(c.campagne)});`);
    etapes.push(`insert into r select '${c.nom}:enveloppe_sans_reglage:lignes', ${lignes(c)};`);
    etapes.push(`insert into optimisation_reglages (campagne_id, workspace_id, parametres) values (${lit(c.campagne)}, ${lit(ESPACE)}, '{"tableaux_depuis_plan": true}');`);
    etapes.push(`insert into r select '${c.nom}:enveloppe_reglee', public.refresh_campaign_rollups(${lit(c.campagne)});`);
    etapes.push(`insert into r select '${c.nom}:enveloppe_reglee:lignes', ${lignes(c)};`);
  }
  // Le suivi du cas strict exige un budget et un CPM : posés après coup, dans la même transaction.
  const strict = CAS.find((c) => c.nom === 'strict')!;
  etapes.push(`select public.refresh_campaign_rollups_depuis_plan(${lit(strict.campagne)}, false);`);
  etapes.push(`insert into r select 'strict:suivi:false', public.get_campaign_suivi(${lit(strict.campagne)});`);
  etapes.push(`select public.refresh_campaign_rollups_depuis_plan(${lit(strict.campagne)}, true);`);
  etapes.push(`insert into r select 'strict:suivi:true', public.get_campaign_suivi(${lit(strict.campagne)});`);
  etapes.push('select jsonb_object_agg(cle, v)::text from r;');
  etapes.push('rollback;');
  return JSON.parse(psql(etapes.join('\n')));
}

const R = rejouer();

describe('refresh_campaign_rollups_depuis_plan (sql/346) — cas construits partagés avec pytest', () => {
  for (const c of CAS) {
    it(`${c.nom} : false = rollup d avant, true = + codes du plan jamais servis`, () => {
      expect(R[`${c.nom}:false:retour`]).toEqual(c.sortie_sans_plan.retour);
      expect(R[`${c.nom}:false:lignes`]).toEqual(c.sortie_sans_plan.lignes);
      expect(R[`${c.nom}:true:retour`]).toEqual(c.sortie_depuis_plan.retour);
      expect(R[`${c.nom}:true:lignes`]).toEqual(c.sortie_depuis_plan.lignes);
      expect((R[`${c.nom}:true:retour`] as { cp_non_servis: number }).cp_non_servis).toBe(2);
    });

    it(`${c.nom} : l enveloppe suit le réglage tableaux_depuis_plan`, () => {
      expect(R[`${c.nom}:enveloppe_sans_reglage`]).toEqual(c.sortie_sans_plan.retour);
      expect(R[`${c.nom}:enveloppe_sans_reglage:lignes`]).toEqual(c.sortie_sans_plan.lignes);
      expect(R[`${c.nom}:enveloppe_reglee`]).toEqual(c.sortie_depuis_plan.retour);
      expect(R[`${c.nom}:enveloppe_reglee:lignes`]).toEqual(c.sortie_depuis_plan.lignes);
    });
  }

  it('effet mesuré sur le cas strict : score 61 → 17 (mêmes chiffres que le Python)', () => {
    expect((R['strict:false:score'] as { score: number }).score).toBe(61);
    expect((R['strict:true:score'] as { score: number }).score).toBe(17);
  });

  it('effet mesuré sur le cas strict : l alerte compte les 2 codes jamais servis', () => {
    const titres = (k: string) => ((R[k] as { alerts?: { kind: string; title: string }[] }).alerts ?? [])
      .filter((a) => a.kind === 'zones_under').map((a) => a.title);
    expect(titres('strict:suivi:false')).toEqual(['1 CP cibles sous 70 % du plan']);
    expect(titres('strict:suivi:true')).toEqual(['3 CP cibles sous 70 % du plan']);
  });

  it('sans livraison : rien avant, les 2 codes du plan après', () => {
    expect(R['sans_livraison:false:lignes']).toEqual([]);
    expect((R['sans_livraison:true:lignes'] as unknown[]).length).toBe(2);
  });
});
