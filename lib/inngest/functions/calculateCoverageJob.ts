/**
 * lib/inngest/functions/calculateCoverageJob.ts
 *
 * Worker Inngest — calcul de couverture d'audience dédupliquée en 2 étapes.
 *
 * Étape 1 — compute :
 *   Appelle compute_coverage_fast → résultat global → job completed
 *
 * Étape 2 — compute-per-poi :
 *   Appelle compute_coverage_per_poi → classement par CIRFA
 *   Résout les noms via poisForMap stocké dans isochrones_cache (_battle_full_)
 *   Stocke breakdown JSON dans calculation_jobs.breakdown
 *   → Realtime notifie CoverageProgress qui affiche le classement
 */

import { inngest }           from '../client';
import { createAdminClient } from '@/lib/auth';


interface CoverageEvent {
  jobId:              string;
  categorie:          string;
  mode:               string;
  target_column:      string;
  isochrone_duration: number;
}

export const calculateCoverageJob = inngest.createFunction(
  {
    id:       'calculate-coverage-job',
    name:     'Calculate Coverage Job',
    retries:  1,
    timeouts: { finish: '6m' },
  },
  { event: 'coverage/calculate' },

  async ({ event, step }) => {
    const { jobId, categorie, mode, target_column, isochrone_duration } = event.data as CoverageEvent;
    const supabase = createAdminClient();

    // ── Étape 1 : couverture globale dédupliquée ────────────────────────────
    const totalAudience = await step.run('compute', async () => {
      console.log(`[coverage] Job ${jobId} — "${categorie}" ${mode}`);

      await supabase
        .from('calculation_jobs')
        .update({
          status:        'processing',
          progress:      10,
          error_message: `> [1/2] union isochrones "${categorie}" → croisement Filosofi...`,
        })
        .eq('id', jobId);

      const { data, error } = await supabase.rpc('compute_coverage_fast', {
        p_categorie: categorie,
        p_mode:      mode,
        p_column:    target_column,
        p_level:     isochrone_duration,
      });

      if (error) throw new Error(error.message);

      const audience = Number(data) || 0;
      console.log(`[coverage] total → ${audience.toLocaleString('fr-FR')} ind.`);

      await supabase
        .from('calculation_jobs')
        .update({
          status:        'completed',
          progress:      100,
          result:        audience,
          error_message: null,
        })
        .eq('id', jobId);

      return audience;
    });

    // ── Étape 2 : classement par POI — activé quand populate-carreaux terminé
    // TODO: réactiver une fois ind/ind_18_24 remplis dans carreaux_filosofi

    return { jobId, result: totalAudience };
  }
);
