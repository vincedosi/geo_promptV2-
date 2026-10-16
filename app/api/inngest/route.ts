import { serve }                       from 'inngest/next';
import { inngest }                     from '@/lib/inngest/client';
import { populateCarreauxColumns }     from '@/lib/inngest/functions/populateCarreauxColumns';
import { civicDailyIngest }            from '@/lib/inngest/functions/civicDailyIngest';

export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [populateCarreauxColumns, civicDailyIngest],
});
