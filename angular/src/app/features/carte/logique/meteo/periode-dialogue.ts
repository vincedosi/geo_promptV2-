import { MAX_FORECAST_DAYS, MAX_HISTORY_DAYS, daysBetween } from './requete';
import type { MeteoMode } from './types';

/**
 * La période du dialogue « Zones météo » — logique pure de `MeteoGeoPanel.tsx` (React, `app/map/analyse/digital/
 * _components/`) : validation (l.120-131), préréglages (l.65-77), période par défaut d'un mode (l.138-147).
 *
 * Toutes les fonctions prennent la date du jour (`todayStr()` de `requete.ts`, UTC comme React) EN PARAMÈTRE : elles
 * sont déterministes et testables sans horloge figée. Les bornes (16 jours de prévision, 90 d'historique) sont celles
 * de la route (`requete.ts`), importées et non recopiées.
 */

export interface Periode {
  readonly debut: string;
  readonly fin: string;
}

export interface Preset {
  readonly label: string;
  readonly periode: (aujourdhui: string) => Periode;
}

/** `addDays` de React : jour civil UTC décalé de `jours`. */
export function ajouterJours(date: string, jours: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** `FORECAST_PRESETS` / `HISTORY_PRESETS`, mêmes libellés, même ordre. */
export const PRESETS: Record<MeteoMode, readonly Preset[]> = {
  forecast: [
    { label: "Aujourd'hui", periode: (t) => ({ debut: t, fin: t }) },
    { label: '3 jours', periode: (t) => ({ debut: t, fin: ajouterJours(t, 3) }) },
    { label: '7 jours', periode: (t) => ({ debut: t, fin: ajouterJours(t, 7) }) },
    { label: '14 jours', periode: (t) => ({ debut: t, fin: ajouterJours(t, 14) }) },
  ],
  history: [
    { label: 'Hier', periode: (t) => ({ debut: ajouterJours(t, -1), fin: ajouterJours(t, -1) }) },
    { label: '7 derniers jours', periode: (t) => ({ debut: ajouterJours(t, -7), fin: ajouterJours(t, -1) }) },
    { label: '30 derniers jours', periode: (t) => ({ debut: ajouterJours(t, -30), fin: ajouterJours(t, -1) }) },
    { label: '90 derniers jours', periode: (t) => ({ debut: ajouterJours(t, -90), fin: ajouterJours(t, -1) }) },
  ],
};

/** `applyModeChange` : prévisions → aujourd'hui + 7 jours ; historique → les 7 derniers jours (jusqu'à hier). */
export function periodeParDefaut(mode: MeteoMode, aujourdhui: string): Periode {
  return mode === 'forecast'
    ? { debut: aujourdhui, fin: ajouterJours(aujourdhui, 7) }
    : { debut: ajouterJours(aujourdhui, -7), fin: ajouterJours(aujourdhui, -1) };
}

/** `validation` : le message de React, ou `null` si la période est acceptable. */
export function validerPeriodeDialogue(mode: MeteoMode, debut: string, fin: string, aujourdhui: string): string | null {
  if (debut > fin) return 'Date de début postérieure à la date de fin';
  if (mode === 'forecast') {
    if (fin < aujourdhui) return "En mode prévisions, la date de fin doit être aujourd'hui ou plus tard";
    if (daysBetween(aujourdhui, fin) > MAX_FORECAST_DAYS) return `Prévisions limitées à ${MAX_FORECAST_DAYS} jours`;
  } else {
    if (fin >= aujourdhui) return "En mode historique, la date de fin doit être avant aujourd'hui";
    if (daysBetween(debut, fin) > MAX_HISTORY_DAYS) return `Historique limité à ${MAX_HISTORY_DAYS} jours`;
  }
  return null;
}
