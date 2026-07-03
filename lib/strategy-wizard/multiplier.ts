/**
 * lib/strategy-wizard/multiplier.ts
 *
 * Logique partagée entre le backend (`app/api/bidding/strategies/preview-weights`)
 * et le frontend (mini-map du wizard Step 2). Garde ces 2 sources synchronisées
 * en évitant la duplication.
 *
 * Inclut :
 *   • computeMultiplier()  — calcul du multiplier d'un CP donné
 *   • inferTier()          — heuristique tier à partir du code postal
 *   • COLOR_SCALE / colorForMultiplier() — mapping couleur unifié pour map+UI
 *   • plainFrenchForMultiplier() — phrase explicative ("+50% au-dessus...")
 */

export type Tier = 'premium_urban' | 'urban' | 'suburban' | 'rural';

export type WeightingMode = 'uniform' | 'by_tier' | 'by_subzone' | 'by_cp_csv';

export interface InZoneWeights {
  mode?: WeightingMode | string;
  value?: number;
  values?: Record<string, number>;
  /** Pour mode 'by_insee_variable' : courbe x→y (multiplier). */
  curve?: Array<{ x: number; y: number }>;
  /** Pour mode 'by_insee_variable' : code de la variable (ex: 'abstention_pres_2022'). */
  variable_code?: string;
}

export interface OutZoneWeights {
  mode?: 'uniform' | 'by_tier' | 'exclusion' | string;
  value?: number;
  values?: Record<string, number>;
}

export interface SubzoneInput {
  name?: string;
  postal_codes: string[];
  multiplier: number;
}

/**
 * Calcule le multiplier final pour un CP donné.
 * 1) Si le CP est dans une sous-zone explicite → applique son multiplier (override)
 * 2) Si in-zone → applique le mode in (uniform / tier / by_cp_csv / by_insee_variable)
 * 3) Si out-zone → applique le mode out (uniform / tier / exclusion)
 *
 * Toujours clampé à [0, 5].
 *
 * @param inseeValues  Optionnel — mapping CP → valeur de la variable INSEE
 *                     (utilisé uniquement pour mode 'by_insee_variable').
 *                     Le frontend l'injecte une fois pour éviter N appels réseau.
 */
export function computeMultiplier(
  isInZone: boolean,
  postalCode: string,
  inWeights: InZoneWeights,
  outWeights: OutZoneWeights,
  subzones?: SubzoneInput[],
  inseeValues?: Record<string, number>,
): number {
  // Override par sous-zone (s'applique uniquement aux CPs in-zone)
  if (isInZone && subzones) {
    for (const sz of subzones) {
      if (sz.postal_codes.includes(postalCode)) {
        return clamp(sz.multiplier);
      }
    }
  }

  let m = 1.0;
  if (isInZone) {
    const inMode = inWeights.mode ?? 'uniform';
    if (inMode === 'uniform') m = Number(inWeights.value ?? 1.0);
    else if (inMode === 'by_tier') {
      const tier = inferTier(postalCode);
      m = Number(inWeights.values?.[tier] ?? 1.0);
    } else if (inMode === 'by_subzone') {
      m = Number(inWeights.value ?? 1.0);
    } else if (inMode === 'by_cp_csv') {
      m = Number(inWeights.values?.[postalCode] ?? 1.0);
    } else if (inMode === 'by_insee_variable') {
      const v = inseeValues?.[postalCode];
      if (v === undefined) {
        // CP sans data → multiplier neutre
        m = 1.0;
      } else {
        m = interpolateOnCurve(inWeights.curve ?? [], v);
      }
    }
  } else {
    const outMode = outWeights.mode ?? 'uniform';
    if (outMode === 'uniform') m = Number(outWeights.value ?? 1.0);
    else if (outMode === 'exclusion') m = 0.0;
    else if (outMode === 'by_tier') {
      const tier = inferTier(postalCode);
      m = Number(outWeights.values?.[tier] ?? 1.0);
    }
  }

  return clamp(m);
}

/**
 * Interpolation linéaire sur une courbe de N points (≥ 2) triés par x croissant.
 * - Si x ≤ premier point : retourne la valeur du premier point (clamp)
 * - Si x ≥ dernier point : retourne la valeur du dernier point (clamp)
 * - Sinon : interpolation linéaire entre les 2 points encadrants
 */
export function interpolateOnCurve(curve: Array<{ x: number; y: number }>, x: number): number {
  if (!curve || curve.length === 0) return 1.0;
  if (curve.length === 1) return curve[0].y;
  if (x <= curve[0].x) return curve[0].y;
  if (x >= curve[curve.length - 1].x) return curve[curve.length - 1].y;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return 1.0;
}

/**
 * Heuristique : devine le tier d'un CP français à partir des 2 premiers chiffres
 * (département). Liste maintenue ici, miroir de l'API backend. Si tu changes
 * une liste, change-la des deux côtés.
 */
export function inferTier(postalCode: string): Tier {
  if (!postalCode || postalCode.length < 2) return 'rural';
  const dept = postalCode.slice(0, 2);
  if (dept === '75') return 'premium_urban';
  if (['69001','69002','69003','69004','69005','69006','69007','69008','69009'].includes(postalCode)) return 'premium_urban';
  if (['13001','13002','13003','13004','13005','13006','13007','13008'].includes(postalCode)) return 'premium_urban';
  if (['33000','31000','44000','59000','67000','06000','21000','38000','35000','34000'].includes(postalCode)) return 'premium_urban';
  if (['92','93','94','69','13','33','31','44','59','67','06','21','38','35','34','54','37','45','42','51','64','76','86','87','49','50','60','71','72','74','17','19','25','26','29','30','41','58','63','79','80','81','82','83','85','89','27','08'].includes(dept)) return 'urban';
  if (['77','78','91','95','01','62','57','68','73','11','15','22','24','40','46','47','55','56','61','65','66','84','88'].includes(dept)) return 'suburban';
  return 'rural';
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0, Math.min(5, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Échelle de couleurs unifiée — utilisée par sliders, badges, choroplèthe carte
// Multiplier 0..5, repère neutre = 1.0
// ─────────────────────────────────────────────────────────────────────────────

export interface MultiplierColorStop {
  /** Borne supérieure exclusive (ou Infinity pour le dernier) */
  ltMax: number;
  /** Couleur hex */
  color: string;
  /** Libellé court (FR) */
  label: string;
}

/** Stops triés par seuil croissant. */
export const MULTIPLIER_COLOR_SCALE: MultiplierColorStop[] = [
  { ltMax: 0.05, color: '#1a1a1a', label: 'Exclu' },         // ×0 ou quasi-0
  { ltMax: 0.5,  color: '#ef4444', label: 'Réduction forte' },
  { ltMax: 0.9,  color: '#f97316', label: 'Réduction' },
  { ltMax: 1.1,  color: '#a0a0a0', label: 'Neutre' },        // ~1.0
  { ltMax: 1.5,  color: '#7dd3c0', label: 'Boost léger' },
  { ltMax: 2.5,  color: '#4ecdc4', label: 'Boost' },         // brand teal
  { ltMax: 3.5,  color: '#2a9d8f', label: 'Boost fort' },
  { ltMax: Infinity, color: '#1a6e64', label: 'Boost extrême' },
];

/** Renvoie le hex correspondant à un multiplier. */
export function colorForMultiplier(m: number): string {
  for (const stop of MULTIPLIER_COLOR_SCALE) {
    if (m < stop.ltMax) return stop.color;
  }
  return MULTIPLIER_COLOR_SCALE[MULTIPLIER_COLOR_SCALE.length - 1].color;
}

/** Libellé court pour un multiplier (utilisé dans la légende). */
export function labelForMultiplier(m: number): string {
  for (const stop of MULTIPLIER_COLOR_SCALE) {
    if (m < stop.ltMax) return stop.label;
  }
  return MULTIPLIER_COLOR_SCALE[MULTIPLIER_COLOR_SCALE.length - 1].label;
}

/**
 * Phrase explicative en français — utilisée sous les sliders.
 *   ×0    → "Exclusion totale"
 *   ×0.7  → "30% en dessous de la base"
 *   ×1.0  → "Au niveau de la base (neutre)"
 *   ×1.5  → "50% au-dessus de la base"
 *   ×2.0  → "2× la base (deux fois plus)"
 */
export function plainFrenchForMultiplier(m: number): string {
  if (m <= 0.001) return 'Exclusion totale (aucune dépense)';
  if (Math.abs(m - 1) < 0.025) return 'Au niveau de la base (neutre)';
  if (m < 1) {
    const pct = Math.round((1 - m) * 100);
    return `${pct}% en dessous de la base`;
  }
  if (m < 2) {
    const pct = Math.round((m - 1) * 100);
    return `${pct}% au-dessus de la base`;
  }
  // ≥ 2 → "n× la base"
  const factor = m.toFixed(m < 3 ? 1 : 0);
  return `${factor}× la base`;
}

/** Libellés FR des tiers (pour UI). */
export const TIER_LABELS_FR: Record<Tier, string> = {
  premium_urban: 'Premium urbain',
  urban:         'Urbain dense',
  suburban:      'Périurbain',
  rural:         'Rural',
};

/** Couleur représentative d'un tier (utilisée pour les pastilles UI + map fallback). */
export const TIER_COLORS: Record<Tier, string> = {
  premium_urban: '#4ecdc4', // teal — densité max
  urban:         '#7dd3c0', // teal clair
  suburban:      '#f7b731', // ambre
  rural:         '#a0a0a0', // gris
};
