/**
 * lib/inngest/functions/populateCarreauxColumns.ts
 *
 * Job one-shot : remplit les colonnes ind, ind_18_24, ind_25_39, ind_40_54, ind_inc
 * dans carreaux_filosofi depuis metadata JSONB, en batches de 100k lignes.
 * Déclenché manuellement via POST /api/inngest (event: 'carreaux/populate-columns').
 *
 * ⛔ NE PAS DÉCLENCHER — coûteux et sans bénéfice (vérifié en base le 2026-09-08)
 *
 * Ce job n'a jamais tourné : les colonnes ind* de carreaux_filosofi sont vides
 * (0 sur un échantillon de 4 552 lignes) alors que `metadata` est rempli à 100 %.
 * C'était le constat C1 de docs/AUDIT_IMPORTS.md. Il est aujourd'hui SANS OBJET :
 *
 *   PERSONNE NE LIT CES COLONNES. `get_tile` lit `metadata->>'ind'` pour la
 *   branche z >= 10 (carreaux 200m) ; il ne lit des colonnes typées que sur
 *   carreaux_2km (z 8-9) et carreaux_5km (z <= 7), qui sont peuplées. Les dix
 *   fonctions métier qui touchent carreaux_filosofi — dont compute_zone_items_audience
 *   et compute_zone_audience_stats du plan média — passent toutes par le JSONB.
 *
 * Le déclencher lancerait donc des UPDATE par lots de 100 000 sur 2,3 M lignes,
 * sur une instance Supabase Nano (250 IOPS), pour remplir des colonnes que rien
 * ne lit. C'est la signature exacte de l'incident du 2026-03-28 : budget I/O
 * épuisé -> Auth 504 -> application indisponible plusieurs heures.
 *
 * Le jour où ces colonnes serviraient vraiment, ce serait une optimisation
 * assumée : il faudrait AUSSI modifier `get_tile` pour les lire à la place du
 * JSONB. Mesurer d'abord — une tuile z=12 met 329 ms, et le suspect n°1 est le
 * LEFT JOIN LATERAL sur ref_departements, pas le parsing JSONB.
 *
 * @see docs/PLAN_SAAS.md §4bis
 */

import { inngest }           from '../client';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';

export const populateCarreauxColumns = inngest.createFunction(
  {
    id:       'populate-carreaux-columns',
    name:     'Populate Carreaux Columns',
    retries:  0,
    timeouts: { finish: '30m' },
  },
  { event: 'carreaux/populate-columns' },

  async ({ step }) => {
    const supabase = createAdminClient();
    let total = 0;
    let batch = 0;

    while (true) {
      const updated = await step.run(`batch-${batch}`, async () => {
        const { data, error } = await supabase.rpc('populate_carreaux_columns', {
          p_batch_size: 100000,
        });
        if (error) throw new Error(error.message);
        logger.info('populate-carreaux', `batch ${batch} — ${data} lignes mises à jour`);
        return data as number;
      });

      total += updated;
      if (updated === 0) break;
      batch++;
    }

    logger.info('populate-carreaux', `terminé — ${total} lignes au total`);
    return { total };
  }
);
