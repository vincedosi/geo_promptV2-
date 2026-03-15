/**
 * lib/inngest/functions/populateCarreauxColumns.ts
 *
 * Job one-shot : remplit les colonnes ind, ind_18_24, ind_25_39, ind_40_54, ind_inc
 * dans carreaux_filosofi depuis metadata JSONB, en batches de 100k lignes.
 * Déclenché manuellement via POST /api/inngest (event: 'carreaux/populate-columns').
 */

import { inngest }           from '../client';
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
        console.log(`[populate-carreaux] batch ${batch} — ${data} lignes mises à jour`);
        return data as number;
      });

      total += updated;
      if (updated === 0) break;
      batch++;
    }

    console.log(`[populate-carreaux] terminé — ${total} lignes au total`);
    return { total };
  }
);
