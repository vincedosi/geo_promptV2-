/**
 * Pattern 3 — Templates de code generation DV360.
 *
 * Le LLM génère le code DV360 sous forme de Python `calculate_bid()`. Cette
 * lib fournit la SPEC d'instructions à inclure dans le system prompt et un
 * helper de validation post-génération (s'assurer que le code retourné contient
 * bien les sections attendues).
 *
 * Extrait de la section "Generation code_dv360 (Python)" du system prompt
 * BiddingCopilot.
 */

export const DV360_PROMPT_SECTION = `### Generation code_dv360 (Python)
- Fonction \`calculate_bid(bid_request)\` qui retourne le multiplicateur de bid.
- Dictionnaire \`COEFFICIENTS\` keyé sur le geo_id Google Ads (utilise le mapping fourni au niveau région).
- Commentaires en-tête avec nom de campagne + cible + date.
- Retour 1.0 par défaut si geo_id non trouvé.
- MIN multiplier = 0.1, MAX = 3.0.`;

export interface DV360Validation {
  ok: boolean;
  missing: string[];
}

/**
 * Sanity check sur le code DV360 généré : vérifie la présence des marqueurs
 * critiques. Ne valide pas la syntaxe Python (responsabilité du caller).
 */
export function validateDV360Code(code: string): DV360Validation {
  const checks: Array<{ marker: string; missing_label: string }> = [
    { marker: 'def calculate_bid', missing_label: 'fonction calculate_bid()' },
    { marker: 'COEFFICIENTS', missing_label: 'dictionnaire COEFFICIENTS' },
    { marker: 'return', missing_label: 'instruction return' },
  ];
  const missing = checks
    .filter(c => !code.includes(c.marker))
    .map(c => c.missing_label);
  return { ok: missing.length === 0, missing };
}
