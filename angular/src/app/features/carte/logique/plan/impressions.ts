/**
 * ⑥ Plan — les IMPRESSIONS PRÉVUES (lot 6, T2 ; arbitrages A-10, A-11 ; spec § 19.2), logique pure.
 *
 * - par plateforme : budget ÷ CPM × 1 000, arrondi à l'unité — la formule de `computeForecast` (`ForecastStrip.tsx`),
 *   verrouillée par `tests/unit/angular/plan-logique-paritaire.test.ts`. Les impressions ne sont jamais stockées :
 *   une seule formule, dérivée à l'affichage ;
 * - totaux : Σ budgets (`total_budget`), Σ impressions (`kpi_target`) et CPM moyen PONDÉRÉ (`forecast_cpm` =
 *   Σ budgets chiffrés ÷ Σ impressions × 1 000) ; une plateforme sans CPM est nommée, elle bloque le lancement ;
 * - par CP (plateforme qui achète au CP) : impressions de la plateforme × multiplicateur ÷ Σ multiplicateurs de SES
 *   CP, la formule de `planned_share` (`refresh_campaign_rollups`). Arrondi par la méthode des plus forts restes : la
 *   somme des CP retombe EXACTEMENT sur le total de la plateforme.
 */

/** Une plateforme cochée, chiffrée. `impressions` nulle sans budget ou sans CPM positif. */
export interface PrevisionPlateforme {
  code: string;
  budget: number | null;
  cpm: number | null;
  impressions: number | null;
}

export interface TotauxPrevus {
  /** Σ budgets saisis (2 décimales), `null` si rien. */
  budget: number | null;
  /** Σ impressions des plateformes chiffrées, `null` si aucune. */
  impressions: number | null;
  /** CPM moyen pondéré (2 décimales) sur les plateformes chiffrées, `null` sans impressions. */
  cpmMoyen: number | null;
  /** Les plateformes sans CPM prévu positif, dans l'ordre des lignes. */
  cpmManquants: string[];
}

/** Un CP d'une extraction (`GET …/extractions/[version]/cp`). */
export interface CpExtraction { code_postal: string; multiplicateur: number }

export interface ImpressionsCp extends CpExtraction { impressions: number }

const arrondi2 = (v: number) => Math.round(v * 100) / 100;
const positif = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Budget ÷ CPM × 1 000, à l'unité ; `null` sans budget ou sans CPM positif (`computeForecast` de React). */
export function impressionsPrevues(budget: number | null, cpm: number | null): number | null {
  return budget && cpm && cpm > 0 ? Math.round((budget / cpm) * 1000) : null;
}

/** Une ligne par plateforme cochée, dans l'ordre donné. */
export function previsions(
  codes: readonly string[], budgets: Readonly<Record<string, number>>, cpms: Readonly<Record<string, number>>,
): PrevisionPlateforme[] {
  return codes.map((code) => {
    const budget = budgets[code] ?? null;
    const cpm = cpms[code] ?? null;
    return { code, budget, cpm, impressions: impressionsPrevues(budget, cpm) };
  });
}

export function totauxPrevus(lignes: readonly PrevisionPlateforme[]): TotauxPrevus {
  const budget = lignes.reduce((s, l) => s + (positif(l.budget) ? l.budget : 0), 0);
  const chiffrees = lignes.filter((l) => l.impressions !== null);
  const impressions = chiffrees.reduce((s, l) => s + (l.impressions ?? 0), 0);
  const budgetChiffre = chiffrees.reduce((s, l) => s + (l.budget ?? 0), 0);
  return {
    budget: budget > 0 ? arrondi2(budget) : null,
    impressions: impressions > 0 ? impressions : null,
    cpmMoyen: impressions > 0 ? arrondi2((budgetChiffre / impressions) * 1000) : null,
    cpmManquants: lignes.filter((l) => !positif(l.cpm)).map((l) => l.code),
  };
}

/**
 * La répartition des impressions d'une plateforme sur SES CP, triée par impressions décroissantes (puis par code).
 * Vide sans impressions, sans CP ou si tous les multiplicateurs sont nuls.
 */
export function repartitionParCp(impressions: number | null, cps: readonly CpExtraction[]): ImpressionsCp[] {
  const somme = cps.reduce((s, c) => s + (positif(c.multiplicateur) ? c.multiplicateur : 0), 0);
  if (!positif(impressions) || somme <= 0) return [];
  const parts = cps
    .filter((c) => positif(c.multiplicateur))
    .map((c, rang) => {
      const exacte = (impressions * c.multiplicateur) / somme;
      return { ...c, rang, impressions: Math.floor(exacte), reste: exacte - Math.floor(exacte) };
    });
  // Plus forts restes : les unités perdues par les planchers vont aux plus grandes parties décimales (à égalité, l'ordre reçu).
  let manque = impressions - parts.reduce((s, p) => s + p.impressions, 0);
  for (const p of [...parts].sort((a, b) => b.reste - a.reste || a.rang - b.rang)) {
    if (manque <= 0) break;
    p.impressions += 1;
    manque -= 1;
  }
  return parts
    .sort((a, b) => b.impressions - a.impressions || a.code_postal.localeCompare(b.code_postal))
    .map(({ code_postal, multiplicateur, impressions: n }) => ({ code_postal, multiplicateur, impressions: n }));
}
