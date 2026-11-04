/**
 * Cas construits de la tâche 2.1 (`services/optimisation/tests/parite/fixtures/tableau-depuis-plan.json`, partagés avec
 * pytest) et leur semis SQL : campagne, stratégie, plan, livraison — à rejouer DANS une transaction annulée.
 * Employé par `rollups-depuis-plan.test.ts` et `rollups-lecteurs-servis.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Sortie { retour: Record<string, unknown>; lignes: unknown[][] }
export interface Cas {
  nom: string; campagne: string; strategie: string; out_zone_weights: Record<string, unknown>;
  plan: [string, string, string | null, boolean][];
  livraison: [string, string, string, number, string][];
  sortie_sans_plan: Sortie; sortie_depuis_plan: Sortie;
}

const FIXTURE = join(process.cwd(), 'services', 'optimisation', 'tests', 'parite', 'fixtures', 'tableau-depuis-plan.json');
export const CAS: Cas[] = JSON.parse(readFileSync(FIXTURE, 'utf8')).cas;
export const ESPACE = '00000000-0000-0000-0000-000000000001';

export const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Les insertions d'un cas (à placer entre `begin;` et `rollback;`). */
export function semer(c: Cas): string {
  const l: string[] = [
    `insert into dsp_campaigns (id, name, organization_id, dsp_source) values (${lit(c.campagne)}, ${lit(`[ESSAI] 2.1 ${c.nom}`)}, ${lit(ESPACE)}, 'dv360');`,
    `insert into bidding_strategies (id, name, campaign_id, algorithm_code, objective_code, out_zone_weights) values (${lit(c.strategie)}, '[ESSAI] 2.1', ${lit(c.campagne)}, 'zone_set', 'maximize_impressions', ${lit(JSON.stringify(c.out_zone_weights))}::jsonb);`,
  ];
  for (const [cp, m, part, actif] of c.plan) {
    l.push(`insert into bidding_zone_configs (strategy_id, postal_code, bid_multiplier, part_prevue, is_active) values (${lit(c.strategie)}, ${lit(cp)}, ${m}, ${part ?? 'null'}, ${actif});`);
  }
  for (const [jour, cp, acteur, imp, sp] of c.livraison) {
    l.push(`insert into dsp_campaign_data (campaign_id, date, country, postal_code, actor, impressions, spend) values (${lit(c.campagne)}, ${lit(jour)}, 'FR', ${lit(cp)}, ${lit(acteur)}, ${imp}, ${sp});`);
  }
  return l.join('\n');
}
