/**
 * Normalisation des textes et nombres d'un plan de régie (spec 2026-10-16-ooh-campagnes § 7). Les fichiers de régie
 * portent des espaces insécables, des montants en texte (« 1 603 636 »), des codes postaux en nombre (13008) : tout
 * passe par ici, jamais par un `trim()` épars (CLAUDE.md : `.trim()` obligatoire sur les données importées).
 */
import type { Cellule } from '@/types/campagnes-media';

/** Majuscules sans accents, ponctuation → espace, espaces réduits, `ST`/`STE` → `SAINT`/`SAINTE`. */
export function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((m) => m !== '')
    .map((m) => (m === 'ST' ? 'SAINT' : m === 'STE' ? 'SAINTE' : m))
    .join(' ');
}

/** Le texte d'une cellule, espaces insécables remplacés et bords retirés ; `null` si vide. */
export function texte(c: Cellule | undefined): string | null {
  if (c === null || c === undefined) return null;
  const t = String(c).replace(/[\u00a0\u202f]/g, ' ').trim();
  return t === '' ? null : t;
}

/** Le nombre d'une cellule : nombre natif, ou texte « 1 603 636 » / « 12,5 » ; `null` sinon. */
export function nombre(c: Cellule | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const t = c.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Le nombre d'une cellule arrondi à l'entier ; `null` sinon. */
export function entier(c: Cellule | undefined): number | null {
  const n = nombre(c);
  return n === null ? null : Math.round(n);
}

/** Un code postal sur cinq chiffres (un nombre 1000 devient « 01000 ») ; `null` sinon. */
export function codePostal(c: Cellule | undefined): string | null {
  if (typeof c === 'number') return Number.isInteger(c) && c > 0 && c < 100000 ? String(c).padStart(5, '0') : null;
  const t = texte(c);
  return t !== null && /^\d{4,5}$/.test(t) ? t.padStart(5, '0') : null;
}

/** Le département d'un code commune INSEE : deux caractères (Corse 2A/2B comprise), trois outre-mer (97x, 98x). */
export function departementDeInsee(insee: string): string {
  return insee.startsWith('97') || insee.startsWith('98') ? insee.slice(0, 3) : insee.slice(0, 2);
}

/**
 * Les cellules d'une ligne nommées par l'en-tête — c'est ainsi que `metadata` garde la ligne d'origine EN ENTIER.
 * Sans en-tête : `colonne N`. En-tête répété : suffixe « (2) ». Une cellule vide sans en-tête est omise.
 */
export function cellulesNommees(entetes: readonly string[], cellules: readonly Cellule[]): Record<string, Cellule> {
  const sortie: Record<string, Cellule> = {};
  const n = Math.max(entetes.length, cellules.length);
  for (let i = 0; i < n; i++) {
    const valeur = cellules[i] ?? null;
    const nom = (entetes[i] ?? '').trim();
    if (nom === '' && valeur === null) continue;
    const base = nom === '' ? `colonne ${i + 1}` : nom;
    let cle = base;
    for (let k = 2; cle in sortie; k++) cle = `${base} (${k})`;
    sortie[cle] = valeur;
  }
  return sortie;
}
