import { serve }                       from 'inngest/next';
import { inngest }                     from '@/lib/inngest/client';
import { calculateCoverageJob }        from '@/lib/inngest/functions/calculateCoverageJob';
import { populateCarreauxColumns }     from '@/lib/inngest/functions/populateCarreauxColumns';
import { agentAutoPilotDaily }         from '@/lib/inngest/functions/agentAutoPilotDaily';
import { agentChatPurgeWeekly }        from '@/lib/inngest/functions/agentChatPurgeWeekly';
import { civicDailyIngest }            from '@/lib/inngest/functions/civicDailyIngest';

export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [calculateCoverageJob, populateCarreauxColumns, agentAutoPilotDaily, agentChatPurgeWeekly, civicDailyIngest],
});
