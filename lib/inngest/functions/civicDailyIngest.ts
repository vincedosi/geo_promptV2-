/**
 * civicDailyIngest — cron Inngest quotidien à 05h30 Europe/Paris.
 *
 * Rafraîchit pollen_map_daily + atmo_map_daily (indices pollen et qualité de
 * l'air nationaux par code postal) via le GeoServer WFS public Atmo — voir
 * lib/civic-health/civic-ingest.ts. Horaire creux volontaire : ~250 lots
 * d'upsert au total, budget I/O Nano préservé.
 */
import { inngest } from '@/lib/inngest/client';
import { runCivicIngest } from '@/lib/civic-health/civic-ingest';

export const civicDailyIngest = inngest.createFunction(
  { id: 'civic-daily-ingest', name: 'Civic health map daily ingest', retries: 2 },
  { cron: 'TZ=Europe/Paris 30 5 * * *' },
  async ({ step }) => {
    return await step.run('run-civic-ingest', async () => {
      try {
        return await runCivicIngest();
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'unknown' };
      }
    });
  },
);
