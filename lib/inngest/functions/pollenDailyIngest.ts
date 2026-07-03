/**
 * pollenDailyIngest — cron Inngest quotidien à 05h30 Europe/Paris.
 *
 * Rafraîchit pollen_map_daily (indice pollen national par code postal) via
 * l'ingestion bulk Atmo — voir lib/civic-health/pollen-ingest.ts. Horaire
 * creux volontaire : ~125 lots d'upsert, budget I/O Nano préservé.
 */
import { inngest } from '@/lib/inngest/client';
import { runPollenIngest } from '@/lib/civic-health/pollen-ingest';

export const pollenDailyIngest = inngest.createFunction(
  { id: 'pollen-daily-ingest', name: 'Pollen map daily ingest', retries: 2 },
  { cron: 'TZ=Europe/Paris 30 5 * * *' },
  async ({ step }) => {
    return await step.run('run-pollen-ingest', async () => {
      try {
        return await runPollenIngest();
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'unknown' };
      }
    });
  },
);
