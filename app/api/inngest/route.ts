import { serve }                       from 'inngest/next';
import { inngest }                     from '@/lib/inngest/client';
import { calculateCoverageJob }        from '@/lib/inngest/functions/calculateCoverageJob';
import { populateCarreauxColumns }     from '@/lib/inngest/functions/populateCarreauxColumns';

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [calculateCoverageJob, populateCarreauxColumns],
});
