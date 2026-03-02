/**
 * GENESIS — Admin types
 *
 * Types partagés pour le dashboard d'administration.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  created_at: string;
  /** Computed by admin API join */
  member_count?: number;
  source_count?: number;
}

export interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: 'panneaux' | 'poi' | 'carreaux';
  category?: string;
  regie?: string;
  original_filename?: string;
  file_format?: string;
  row_count: number;
  valid_count: number;
  error_count: number;
  mapping?: Record<string, string>;
  geo_config?: Record<string, string>;
  filter_fields?: string[];
  ai_summary?: string;
  import_date: string;
  status: string;
  shared_with?: string[];
  organization_id?: string;
  organizations?: { name: string; slug: string };
}

/** Alias rétrocompat (utilisé dans health/page.tsx et health/route.ts) */
export type Check = HealthCheck;

export interface HealthCheck {
  name: string;
  status: 'OK' | 'WARN' | 'ERROR';
  value?: string;
  message: string;
}

export interface HealthResponse {
  success: boolean;
  status: 'OK' | 'WARN' | 'ERROR';
  summary: string;
  checks: HealthCheck[];
  timestamp: string;
}
