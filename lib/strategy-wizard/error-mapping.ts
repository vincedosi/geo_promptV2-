/**
 * lib/strategy-wizard/error-mapping.ts
 *
 * Traduit les `issues[]` Zod retournés par /api/bidding/strategies (POST/PATCH)
 * en messages FR groupés par étape du wizard, avec lien "modifier" cliquable.
 *
 * Pourquoi : sans ça l'user voit "Erreur : invalid_body" et abandonne.
 * Avec : "Étape 3 — Objectif primaire : champ obligatoire" + bouton qui re-route.
 */

export interface ZodIssue {
  code?: string;
  message?: string;
  path?: Array<string | number>;
  expected?: string;
  received?: string;
}

export interface FieldError {
  stepIdx: number;
  stepLabel: string;
  field: string;
  reason: string;
}

export interface HumanizedError {
  summary: string;
  fields: FieldError[];
}

// Mapping schema field path → étape wizard + libellé FR du champ
const FIELD_MAP: Record<string, { stepIdx: number; field: string }> = {
  // Step 1 — Identité
  name:               { stepIdx: 1, field: 'Nom de la stratégie' },
  inventory_type:     { stepIdx: 1, field: 'Type d\'inventaire' },
  start_date:         { stepIdx: 1, field: 'Date de début' },
  end_date:           { stepIdx: 1, field: 'Date de fin' },
  advertiser:         { stepIdx: 1, field: 'Annonceur' },
  brand:              { stepIdx: 1, field: 'Marque / produit' },
  internal_reference: { stepIdx: 1, field: 'Référence interne' },

  // Step 2 — Périmètre & Pondération
  scope_type:         { stepIdx: 2, field: 'Périmètre géographique' },
  zone_id:            { stepIdx: 2, field: 'Zone custom' },
  weighting_mode:     { stepIdx: 2, field: 'Mode de pondération' },
  in_zone_weights:    { stepIdx: 2, field: 'Multipliers dans la zone' },
  out_zone_weights:   { stepIdx: 2, field: 'Multipliers hors de la zone' },
  subzones:           { stepIdx: 2, field: 'Sous-zones' },

  // Step 3 — Objectif
  algorithm_code:     { stepIdx: 3, field: 'Algorithme' },
  objective_code:     { stepIdx: 3, field: 'Objectif primaire' },
  kpi_target:         { stepIdx: 3, field: 'Cible quantifiée' },
  kpi_secondary:      { stepIdx: 3, field: 'KPIs secondaires' },
  attribution_model:  { stepIdx: 3, field: 'Modèle d\'attribution' },

  // Step 4 — Budget
  total_budget:               { stepIdx: 4, field: 'Budget total' },
  currency:                   { stepIdx: 4, field: 'Devise' },
  daily_budget_max:           { stepIdx: 4, field: 'Budget journalier max' },
  pacing_strategy:            { stepIdx: 4, field: 'Distribution temporelle' },
  dsp_external_id:            { stepIdx: 4, field: 'ID DSP externe' },
  forecast_cpm:               { stepIdx: 4, field: 'CPM prévisionnel' },
  frequency_cap_imps:         { stepIdx: 4, field: 'Plafond impressions' },
  frequency_cap_period_days:  { stepIdx: 4, field: 'Période plafond (jours)' },

  // Step 5 — ML & Agent
  execution_mode:             { stepIdx: 5, field: 'Mode d\'exécution' },
  init_preset_code:           { stepIdx: 5, field: 'Preset d\'initialisation' },
  agent_autonomy_override:    { stepIdx: 5, field: 'Autonomie de l\'agent' },
  notification_channels:      { stepIdx: 5, field: 'Canaux de notification' },
  alert_severity_threshold:   { stepIdx: 5, field: 'Seuil d\'alerte' },

  campaign_id:        { stepIdx: 1, field: 'Campagne DSP' },
};

const STEP_LABELS: Record<number, string> = {
  1: 'Identité',
  2: 'Périmètre & Pondération',
  3: 'Objectif',
  4: 'Budget',
  5: 'ML & Agent',
};

/**
 * Traduit un message Zod brut en français court et actionnable.
 * Couvre les codes les plus fréquents : invalid_type, too_small, too_big, invalid_string, etc.
 */
function humanizeZodMessage(issue: ZodIssue): string {
  const code = issue.code ?? '';
  const msg = issue.message ?? '';

  if (code === 'invalid_type') {
    if (issue.received === 'undefined' || issue.received === 'null') {
      return 'champ obligatoire';
    }
    return `type attendu : ${issue.expected ?? 'inconnu'}`;
  }
  if (code === 'too_small') {
    if (msg.toLowerCase().includes('string') || /caractère/i.test(msg)) {
      return 'valeur trop courte';
    }
    return 'valeur trop petite';
  }
  if (code === 'too_big') return 'valeur trop grande';
  if (code === 'invalid_string') {
    if (msg.toLowerCase().includes('uuid')) return 'identifiant invalide';
    if (msg.toLowerCase().includes('email')) return 'email invalide';
    return msg || 'format invalide';
  }
  if (code === 'invalid_enum_value') return 'valeur non autorisée';
  if (code === 'unrecognized_keys') return 'champ inattendu';

  return msg || 'invalide';
}

export function humanizeActivationError(issues: ZodIssue[]): HumanizedError {
  if (!issues || issues.length === 0) {
    return { summary: 'Erreur de validation', fields: [] };
  }

  // Dédoublonne par path[0] (un même champ peut générer plusieurs issues)
  const seen = new Set<string>();
  const fields: FieldError[] = [];

  for (const issue of issues) {
    const root = String(issue.path?.[0] ?? '');
    if (!root || seen.has(root)) continue;
    seen.add(root);

    const mapped = FIELD_MAP[root] ?? { stepIdx: 1, field: root };
    fields.push({
      stepIdx: mapped.stepIdx,
      stepLabel: STEP_LABELS[mapped.stepIdx] ?? `Étape ${mapped.stepIdx}`,
      field: mapped.field,
      reason: humanizeZodMessage(issue),
    });
  }

  // Ordre par étape pour affichage naturel
  fields.sort((a, b) => a.stepIdx - b.stepIdx);

  const count = fields.length;
  const summary = count === 1
    ? 'Un champ obligatoire est manquant ou invalide'
    : `${count} champs obligatoires sont manquants ou invalides`;

  return { summary, fields };
}
