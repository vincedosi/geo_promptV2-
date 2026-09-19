/**
 * Helpers partagés des clients santé environnementale (WFS public + API Atmo
 * authentifiée + mock). Évite la triplication de ces utilitaires entre
 * wfs-civic.ts, atmofrance-client.ts et mock-provider.ts.
 */
import type { PollenLevel, PollenSpecies } from './types';
import { parsePollenLevel } from './levels';
import { fetchAvecDelai } from '@/lib/http/fetch-avec-delai';

const FORMAT_PARIS = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Date ISO YYYY-MM-DD à `offsetDays` jours d'aujourd'hui (0 = jour J), en
 * **heure de Paris**.
 *
 * Atmo publie ses indices par jour civil français (`date_ech`). L'ancienne
 * version lisait `toISOString()`, c'est-à-dire la date UTC : entre 22 h (été)
 * ou 23 h (hiver) et minuit, heure de Paris, elle rendait la VEILLE, et un
 * rejeu manuel de l'ingestion à cette heure-là demandait au WFS le jour J-1
 * en croyant demander J. Le cron de 05 h 30 n'était pas touché ; un opérateur
 * qui relance le soir, si.
 */
export function isoDate(offsetDays = 0, now: Date = new Date()): string {
  const jourParis = FORMAT_PARIS.format(now); // fr-CA → YYYY-MM-DD
  if (offsetDays === 0) return jourParis;
  const [y, m, d] = jourParis.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** fetch avec délai d'expiration, cache désactivé. Délègue à `fetchAvecDelai` (erreur nommée, minuteur nettoyé). */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetchAvecDelai(url, { ...init, cache: 'no-store' }, timeoutMs);
}

/** Champs pollen bruts d'une feature (WFS ou dataset 122) — clés code_ et conc_ par espèce. */
export interface PollenRawProps {
  code_ambr?: unknown; code_arm?: unknown; code_aul?: unknown;
  code_boul?: unknown; code_gram?: unknown; code_oliv?: unknown;
  conc_ambr?: unknown; conc_arm?: unknown; conc_aul?: unknown;
  conc_boul?: unknown; conc_gram?: unknown; conc_oliv?: unknown;
}

/** Niveaux 0-6 par espèce (0 si absent/invalide). */
export function buildEspeces(p: PollenRawProps): Record<PollenSpecies, PollenLevel> {
  const lvl = (v: unknown): PollenLevel => parsePollenLevel(v) ?? 0;
  return {
    ambroisie: lvl(p.code_ambr),
    armoise: lvl(p.code_arm),
    aulne: lvl(p.code_aul),
    bouleau: lvl(p.code_boul),
    graminees: lvl(p.code_gram),
    olivier: lvl(p.code_oliv),
  };
}

/** Concentrations grains/m³ par espèce (0 si absent/invalide/≤ 0). */
export function buildConcentrations(p: PollenRawProps): Record<PollenSpecies, number> {
  const conc = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    ambroisie: conc(p.conc_ambr),
    armoise: conc(p.conc_arm),
    aulne: conc(p.conc_aul),
    bouleau: conc(p.conc_boul),
    graminees: conc(p.conc_gram),
    olivier: conc(p.conc_oliv),
  };
}
