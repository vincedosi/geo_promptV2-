/**
 * Copie de `types/dsp.ts` (lot 6, 2026-10-06) ; parité par assignabilité mutuelle :
 * `tests/unit/angular/admin-logique-paritaire.test.ts`.
 */
export type DspProvider = 'dv360' | 'meta' | 'tiktok' | 'ttd';
export type DspAuthMethod = 'service_account' | 'oauth';
export type DspStatus = 'disconnected' | 'connected' | 'error';
export type DspLogCategory = 'api_call' | 'connection' | 'job';
export type DspLogLevel = 'info' | 'warn' | 'error';

/** Vue publique d'une connexion — JAMAIS de secret renvoyé au client. */
export interface DspConnectionPublic {
  provider: DspProvider;
  auth_method: DspAuthMethod | null;
  status: DspStatus;
  partner_id: string | null;
  oauth_client_id: string | null; // Client ID OAuth saisi via formulaire (non secret), null sinon
  has_credentials: boolean; // clé SA ou refresh token présent (booléen calculé serveur, jamais la valeur)
  advertiser_ids: { id: string; name: string }[];
  token_expires_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

export interface DspApiLogRow {
  id: string;
  provider: DspProvider;
  category: DspLogCategory;
  level: DspLogLevel;
  action: string;
  status_code: number | null;
  duration_ms: number | null;
  message: string | null;
  created_at: string;
}
