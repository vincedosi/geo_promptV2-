/**
 * Pattern 3 — Templates de code generation par DSP.
 *
 * Centralise les sections de prompt + helpers de validation pour DV360,
 * Adform et TTD. Importer depuis ici plutôt que les sous-modules pour
 * faciliter l'extension future (ex. Xandr, Amazon DSP).
 */
export { DV360_PROMPT_SECTION, validateDV360Code, type DV360Validation } from './dv360';
export { ADFORM_PROMPT_SECTION, validateAdformJSON, type AdformRule, type AdformValidation } from './adform';
export { TTD_PROMPT_SECTION, validateTTDJSON, type TTDLine, type TTDValidation } from './ttd';
