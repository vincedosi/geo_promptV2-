/**
 * Schéma Zod de POST /api/bidding/strategies/[id]/adjust — extrait de la route
 * dans lib/ car Next.js App Router n'autorise QUE des exports connus
 * (GET/POST/dynamic/maxDuration/…) sur un fichier route.ts : `export const
 * AdjustSchema` y casse le typage `tsc --noEmit` (route module contract).
 * La route importe et réexporte ce schéma pour l'utiliser tel quel.
 */
import { z } from 'zod';
import { ChannelBudgetsSchema, DspLinksSchema, CampaignChannelsSchema } from '@/lib/campaigns/channels';

export const AdjustSchema = z.object({
  reason: z.string().min(3).max(2000),
  changes: z.object({
    channel_budgets: ChannelBudgetsSchema.optional(),
    forecast_cpm: z.number().positive().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    execution_mode: z.enum(['monitor_only', 'suggest', 'auto']).optional(),
    intensity: z.enum(['doux', 'marque', 'fort']).optional(),
    zone: z.object({
      scope_type: z.enum(['national', 'custom_zone']),
      zone_id: z.string().uuid().nullable(),
    }).optional(),
    channels: CampaignChannelsSchema.optional(),
  }),
  links: DspLinksSchema.optional(),
}).refine((o) => Object.keys(o.changes).length > 0 || o.links !== undefined, { message: 'aucun_changement' });
