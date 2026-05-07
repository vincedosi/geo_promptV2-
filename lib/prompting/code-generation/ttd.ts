/**
 * Pattern 3 — Templates de code generation TTD (The Trade Desk).
 *
 * Nouvelle plateforme cible (cohérence avec A4.3 — la stratégie démo
 * MAGELIAN utilise TTD). TTD attend un payload JSON pour son endpoint
 * "Bid Multiplier" (par "Bid List").
 */

export const TTD_PROMPT_SECTION = `### Generation code_ttd (JSON Bid List)
- Tableau \`Lines\` avec chaque entrée : \`{ "Dimension": "Country", "Value": "FR", "BidLine": { "BidLineMultiplier": 1.45 } }\`.
- Pour les régions, utilise \`Dimension: "Region"\` + \`Value\` = code ISO ou nom (selon spec TTD).
- Pour les CPs, utilise \`Dimension: "PostalCode"\` + \`Value\` = code postal.
- BidLineMultiplier MIN 0.1, MAX 3.0.`;

export interface TTDLine {
  Dimension: 'Country' | 'Region' | 'PostalCode' | string;
  Value: string;
  BidLine: { BidLineMultiplier: number };
}

export interface TTDValidation {
  ok: boolean;
  errors: string[];
}

export function validateTTDJSON(raw: string): TTDValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`JSON invalide : ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Le payload doit être un objet'] };
  }
  const lines = (parsed as { Lines?: unknown }).Lines;
  if (!Array.isArray(lines)) {
    return { ok: false, errors: ['Champ "Lines" manquant ou non-array'] };
  }
  const errors: string[] = [];
  lines.forEach((l, i) => {
    const line = l as Partial<TTDLine>;
    if (!line.Dimension) errors.push(`Line[${i}] : Dimension manquant`);
    if (!line.Value) errors.push(`Line[${i}] : Value manquant`);
    const m = line.BidLine?.BidLineMultiplier;
    if (typeof m !== 'number') errors.push(`Line[${i}] : BidLineMultiplier non numérique`);
    if (typeof m === 'number' && (m < 0.1 || m > 3.0)) {
      errors.push(`Line[${i}] : BidLineMultiplier ${m} hors [0.1, 3.0]`);
    }
  });
  return { ok: errors.length === 0, errors };
}
