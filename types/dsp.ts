/** MAGELIAN — types partagés pour l'onglet API (connexions DSP). */

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
