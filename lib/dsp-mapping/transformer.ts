/**
 * GEOMATIK — Registry des transforms appliquées aux valeurs CSV avant cast.
 *
 * Les `dsp_source_mappings.transform` sont stockés en TEXT côté DB. Cette
 * couche valide à l'usage : si la transform référencée n'existe pas ici,
 * `applyTransform()` lève une `UnknownTransformError` — pas de fallback
 * silencieux.
 *
 * Pour ajouter une transform :
 *   1. Ajouter une entrée dans `TRANSFORMS` ci-dessous
 *   2. Tester
 *   3. Référencer la nouvelle clé dans `dsp_source_mappings.transform`
 */

import { UnknownTransformError } from './types';

type TransformFn = (value: string) => unknown;

const MONTH_NAMES_FR_EN: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  janv: '01', févr: '02', mars: '03', avr: '04', mai: '05', juin: '06',
  juil: '07', août: '08', sept: '09', déc: '12',
};

/**
 * 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY' ou 'YYYY-MM-DD' → 'YYYY-MM-DD'.
 * Repris du parser legacy (lib/campaigns/column-mappings.parseDate) pour
 * garantir le comportement Adform identique.
 */
function parseEuDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  // EU first : DD/MM/YYYY (ambigu avec MM/DD/YYYY → on tranche EU pour Adform/DSP FR)
  const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  const ymd = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  // "01 Jan 2026" / "01-janv-2026"
  const textDate = s.match(/^(\d{1,2})[\s-](\w+)[\s-](\d{4})$/i);
  if (textDate) {
    const key = textDate[2].toLowerCase().slice(0, 4);
    const mm = MONTH_NAMES_FR_EN[key.slice(0, 3)] ?? MONTH_NAMES_FR_EN[key];
    if (mm) return `${textDate[3]}-${mm}-${textDate[1].padStart(2, '0')}`;
  }

  // Excel serial number
  const serial = Number(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const d = new Date((serial - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  return ''; // → laissera le cast date échouer si requis
}

const TRANSFORMS: Record<string, TransformFn> = {
  // Texte
  trim: (v) => (v ?? '').toString().trim(),
  upper: (v) => (v ?? '').toString().toUpperCase(),
  lower: (v) => (v ?? '').toString().toLowerCase(),

  // Nombres
  divide_1000: (v) => {
    const n = Number((v ?? '').toString().replace(/[\s,]/g, ''));
    if (!isFinite(n)) return null;
    return n / 1000;
  },
  strip_currency: (v) => {
    const s = (v ?? '').toString().replace(/[€$£\s]/g, '').replace(/,/g, '.');
    const n = Number(s);
    return isFinite(n) ? n : null;
  },

  // Dates
  parse_eu_date: (v) => parseEuDate((v ?? '').toString()),
};

/** Liste des transforms reconnues — utile pour audit / docs. */
export function listKnownTransforms(): string[] {
  return Object.keys(TRANSFORMS).sort();
}

/**
 * Applique la transform `transform` à `value`. Si `transform` est null/empty,
 * retourne la valeur trimée par défaut. Si `transform` est référencée mais
 * inconnue côté code, lève `UnknownTransformError` — pas de silent fail.
 */
export function applyTransform(value: string, transform: string | null): unknown {
  if (transform === null || transform === undefined || transform === '') {
    return value;
  }
  const fn = TRANSFORMS[transform];
  if (!fn) {
    throw new UnknownTransformError(transform);
  }
  return fn(value);
}
