/**
 * Statut de campagne — logique pure (zéro I/O, testable).
 * Statut effectif = override manuel sinon dérivé du calendrier.
 * Dates au format ISO 'YYYY-MM-DD' (comparaison lexicographique correcte).
 */

export type CampaignStatus = 'a_venir' | 'en_cours' | 'en_pause' | 'terminee' | 'archivee';
export type StatusOverride = 'paused' | 'ended' | 'archived';

/** Seuil (jours) au-delà duquel une campagne « en cours » sans donnée est signalée. */
export const FRESHNESS_DAYS = 3;

const OVERRIDE_TO_STATUS: Record<StatusOverride, CampaignStatus> = {
  paused: 'en_pause',
  ended: 'terminee',
  archived: 'archivee',
};

export function effectiveCampaignStatus(
  input: { date_start: string | null; date_end: string | null; status_override: StatusOverride | null },
  today: string,
): CampaignStatus {
  if (input.status_override) return OVERRIDE_TO_STATUS[input.status_override];
  if (input.date_start && today < input.date_start) return 'a_venir';
  if (input.date_end && today > input.date_end) return 'terminee';
  return 'en_cours';
}

/** Nombre de jours entiers entre deux dates ISO (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function campaignNeedsAttention(
  input: { status: CampaignStatus; last_data_date: string | null },
  today: string,
  freshnessDays: number = FRESHNESS_DAYS,
): boolean {
  if (input.status !== 'en_cours') return false;
  if (!input.last_data_date) return true;
  return daysBetween(input.last_data_date, today) > freshnessDays;
}

/** Libellé + couleur (token design system) par statut. */
export const STATUS_META: Record<CampaignStatus, { label: string; colorVar: string }> = {
  a_venir:  { label: 'À venir',   colorVar: 'var(--text-secondary)' },
  en_cours: { label: 'En cours',  colorVar: 'var(--brand-teal)' },
  en_pause: { label: 'En pause',  colorVar: 'var(--warning)' },
  terminee: { label: 'Terminée',  colorVar: 'var(--text-tertiary)' },
  archivee: { label: 'Archivée',  colorVar: 'var(--text-tertiary)' },
};
