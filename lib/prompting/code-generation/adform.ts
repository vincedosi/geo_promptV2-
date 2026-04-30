/**
 * Pattern 3 — Templates de code generation Adform.
 *
 * Adform attend un JSON de règles `{ targeting: { geo: { code } }, bid_modifier }`.
 */

export const ADFORM_PROMPT_SECTION = `### Generation code_adform (JSON)
- Tableau \`rules\` avec chaque entrée : \`{ "targeting": { "geo": { "code": "FR-11" }}, "bid_modifier": 1.45 }\`.
- Utilise le code ISO 3166-2 FR pour les régions (FR-11, FR-32, etc.), sinon code INSEE pour les départements.
- bid_modifier MIN 0.1, MAX 3.0.`;

export interface AdformRule {
  targeting: { geo: { code: string } };
  bid_modifier: number;
}

export interface AdformValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Vérifie qu'un payload JSON Adform a la bonne forme et que tous les
 * `bid_modifier` sont dans [0.1, 3.0].
 */
export function validateAdformJSON(raw: string): AdformValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`JSON invalide : ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Le payload doit être un objet'] };
  }
  const rules = (parsed as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) {
    return { ok: false, errors: ['Champ "rules" manquant ou non-array'] };
  }
  const errors: string[] = [];
  rules.forEach((r, i) => {
    const rule = r as Partial<AdformRule>;
    if (!rule.targeting?.geo?.code) errors.push(`règle[${i}] : targeting.geo.code manquant`);
    if (typeof rule.bid_modifier !== 'number') errors.push(`règle[${i}] : bid_modifier non numérique`);
    if (typeof rule.bid_modifier === 'number' && (rule.bid_modifier < 0.1 || rule.bid_modifier > 3.0)) {
      errors.push(`règle[${i}] : bid_modifier ${rule.bid_modifier} hors [0.1, 3.0]`);
    }
  });
  return { ok: errors.length === 0, errors };
}
