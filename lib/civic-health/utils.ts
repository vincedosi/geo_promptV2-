/**
 * Helpers partagés des clients santé environnementale (WFS public + API Atmo
 * authentifiée + mock). Évite la triplication de ces utilitaires entre
 * wfs-civic.ts, atmofrance-client.ts et mock-provider.ts.
 */
import type { PollenLevel, PollenSpecies } from './types';
import { parsePollenLevel } from './levels';

/** Date ISO YYYY-MM-DD à `offsetDays` jours d'aujourd'hui (0 = jour J). */
export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** fetch avec AbortController + timeout, cache désactivé. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
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
