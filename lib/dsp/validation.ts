/** MAGELIAN — schémas Zod des routes DSP. */
import { z } from 'zod';

export const dv360ConnectSchema = z.object({
  auth_method: z.literal('service_account'), // OAuth passe par /oauth/start, pas ce body
  partner_id: z.string().trim().min(1, 'partner_id requis'),
  service_account_json: z.string().trim().min(1, 'clé Service Account requise'),
});
export type Dv360ConnectInput = z.infer<typeof dv360ConnectSchema>;

/** Config du client OAuth saisie via formulaire (secret chiffré avant stockage). */
export const dv360OAuthConfigSchema = z.object({
  partner_id: z.string().trim().min(1, 'Partner ID requis'),
  oauth_client_id: z.string().trim().min(1, 'Client ID requis'),
  oauth_client_secret: z.string().trim().min(1, 'Client Secret requis'),
});
export type Dv360OAuthConfigInput = z.infer<typeof dv360OAuthConfigSchema>;

export const logsQuerySchema = z.object({
  provider: z.enum(['dv360', 'meta', 'tiktok', 'ttd']).optional(),
  level: z.enum(['info', 'warn', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
