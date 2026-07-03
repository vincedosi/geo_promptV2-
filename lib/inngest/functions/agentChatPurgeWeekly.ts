/**
 * agentChatPurgeWeekly — cron Inngest hebdomadaire qui appelle
 * la fonction SQL purge_old_agent_chat_messages pour supprimer
 * les messages chat de plus de 7 jours.
 */
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/auth';

export const agentChatPurgeWeekly = inngest.createFunction(
  { id: 'agent-chat-purge-weekly', name: 'Agent chat purge weekly' },
  { cron: 'TZ=Europe/Paris 0 4 * * 0' }, // dimanche 04h00
  async ({ step }) => {
    return await step.run('purge-old-chat', async () => {
      const supabase = createAdminClient();
      const { data, error } = await supabase.rpc('purge_old_agent_chat_messages');
      if (error) return { error: error.message };
      return { purged: data ?? 0 };
    });
  },
);
