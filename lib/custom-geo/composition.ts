/**
 * @file lib/custom-geo/composition.ts — de quoi une zone est faite, en clair
 * (Tâche 15, 2026-09-13).
 *
 * « Cible composite (2 zones) — juil. 2026 » ne dit pas de quoi la zone est
 * faite. Or c'est cette zone qui part vers un DSP : savoir si elle vient d'un
 * seuil de revenu, d'une bataille isochrone ou d'une soustraction change ce
 * qu'on en fait, et ce qu'on ose en dire au client.
 *
 * **Description DÉRIVÉE, jamais stockée.** Elle se recalcule de `source_type`
 * et `source_metadata` à chaque affichage, sans aucune requête. Stocker un
 * libellé le figerait au jour de la création : il mentirait dès qu'un libellé
 * d'indicateur change, et il faudrait une migration pour le corriger.
 *
 * ── Ce que ce module doit encaisser ───────────────────────────────────────
 * `source_metadata` est un `jsonb` écrit par une dizaine de chemins d'import
 * différents, dont certains antérieurs à ce module. **Rien n'en garantit la
 * forme.** Les formes réellement présentes en base au 2026-09-13 :
 *
 *   composite            { kind, member_zone_ids }
 *   indicator_threshold  { indicator, kind, materialized_at, operator,
 *                          threshold, unit, scale }
 *   isochrone_battle     { cache_key, category, contributing_layers, mode,
 *                          paliers, poi_count, pois, transformation }
 *
 * — aucune ne correspondant exactement aux exemples du plan. D'où la règle de
 * ce fichier : **ne jamais lever, et toujours rendre une chaîne non vide.**
 * Une description est un confort ; la faire planter ferait disparaître la
 * liste des zones, qui est l'outil de travail.
 */
import { getSourceTypeLabel } from './source-type-labels';
import { formaterNombre } from '@/lib/format/nombre';

/** Libellés des types que `source-type-labels.ts` ne connaît pas encore. */
const LIBELLES_COMPLEMENTAIRES: Record<string, string> = {
  battle: 'Bataille isochrone',
  intersection: 'Intersection de zones',
  difference: 'Soustraction de zones',
  score_composite: 'Score composite',
  codes_postaux: 'Liste de codes postaux',
  rayon: 'Rayon autour d’un point',
  dessin: 'Tracé libre',
  iris: 'Sélection IRIS',
};

/** Lit une valeur sans jamais supposer sa forme. */
function texte(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function nombre(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function tableau(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** « et » entre les deux derniers éléments, virgules avant. */
function enumerer(elements: string[]): string {
  if (elements.length === 0) return '';
  if (elements.length === 1) return elements[0];
  return `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`;
}

const OPERATEURS: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<' };

/**
 * Décrit la composition d'une zone en une phrase lisible.
 *
 * Rend toujours une chaîne non vide : à défaut d'information exploitable, le
 * libellé du type. « Composite multi-layers » vaut mieux qu'une ligne vide, et
 * infiniment mieux qu'une exception.
 */
export function decrireComposition(
  sourceType: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  const m: Record<string, unknown> = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
    ? metadata
    : {};

  const parDefaut = () =>
    LIBELLES_COMPLEMENTAIRES[sourceType] ?? getSourceTypeLabel(sourceType).label;

  // ── Soustraction : la plus importante à dire, parce qu'elle n'est pas
  // symétrique et qu'on ne peut pas la deviner du résultat. ───────────────
  const base = texte(m.base_label);
  const retires = tableau(m.retires_labels).map(texte).filter((x): x is string => x !== null);
  if (base && retires.length) return `${base} moins ${enumerer(retires)}`;

  const operation = texte(m.operation) ?? texte(m.kind);
  const noms = tableau(m.member_zone_names).map(texte).filter((x): x is string => x !== null);

  if (operation === 'difference' && noms.length >= 2) {
    return `${noms[0]} moins ${enumerer(noms.slice(1))}`;
  }
  if (operation === 'intersection' && noms.length >= 2) {
    // « A, B et C en commun » etait FAUX des trois zones : l'operation rend
    // A ∩ (B ∪ C), pas A ∩ B ∩ C. Mesure sur des zones reelles : 257,94 km2
    // contre 2,83 pour la vraie intersection des trois. « Restreint a » decrit
    // exactement ce qui est calcule.
    return noms.length === 2
      ? `${noms[0]} et ${noms[1]} en commun`
      : `${noms[0]} restreint à ${enumerer(noms.slice(1))}`;
  }

  // ── Union / composite ──────────────────────────────────────────────────
  const membres = tableau(m.member_labels).map(texte).filter((x): x is string => x !== null);
  if (membres.length) return enumerer(membres);
  if (noms.length) return enumerer(noms);

  const ids = tableau(m.member_zone_ids);
  if (ids.length) {
    const verbe = operation === 'intersection' ? 'Intersection'
      : operation === 'difference' ? 'Soustraction'
      : 'Union';
    return `${verbe} de ${ids.length} zones`;
  }

  // ── Seuil d'indicateur ─────────────────────────────────────────────────
  const indicateur = texte(m.indicator);
  const seuil = nombre(m.threshold);
  if (indicateur && seuil !== null) {
    const op = OPERATEURS[texte(m.operator) ?? ''] ?? texte(m.operator) ?? '≥';
    const unite = texte(m.unit);
    return `${indicateur} ${op} ${formaterNombre(seuil)}${unite ? ` ${unite}` : ''}`;
  }

  // ── Score composite (Tâche 12) ─────────────────────────────────────────
  const indicateurs = tableau(m.indicateurs);
  const seuilScore = nombre(m.seuil);
  if (indicateurs.length && seuilScore !== null) {
    return `Score composite ≥ ${formaterNombre(seuilScore)} sur ${indicateurs.length} indicateur${indicateurs.length > 1 ? 's' : ''}`;
  }

  // ── Bataille isochrone ─────────────────────────────────────────────────
  const nbPoi = nombre(m.poi_count);
  const categorie = texte(m.category);
  const paliers = tableau(m.paliers).map(nombre).filter((x): x is number => x !== null);
  if (nbPoi !== null || categorie || paliers.length) {
    const morceaux: string[] = [];
    if (nbPoi !== null) morceaux.push(`${formaterNombre(nbPoi)} POI${categorie ? ` ${categorie}` : ''}`);
    else if (categorie) morceaux.push(categorie);
    if (paliers.length) morceaux.push(`paliers ${paliers.join('/')} min`);
    if (morceaux.length) return `Bataille isochrone — ${morceaux.join(', ')}`;
  }

  // ── Capture simple : un nombre d'objets ────────────────────────────────
  const compte = nombre(m.feature_count);
  if (compte !== null) {
    const quoi = sourceType === 'iris' ? 'IRIS'
      : sourceType === 'carreaux_filosofi' ? 'carreaux'
      : 'objets';
    return `${formaterNombre(compte)} ${quoi} sélectionné${compte > 1 ? 's' : ''}`;
  }

  // ── Liste de codes postaux (Tâche 16) ──────────────────────────────────
  const nbCp = nombre(m.n_codes_postaux);
  if (nbCp !== null) {
    return `${formaterNombre(nbCp)} code${nbCp > 1 ? 's' : ''} postal${nbCp > 1 ? 'ux' : ''} importé${nbCp > 1 ? 's' : ''}`;
  }

  // ── Rayon (Tâche 17) ───────────────────────────────────────────────────
  const rayon = nombre(m.rayon_m);
  if (rayon !== null) {
    return rayon >= 1000
      ? `Rayon de ${formaterNombre(Math.round(rayon / 100) / 10)} km`
      : `Rayon de ${formaterNombre(rayon)} m`;
  }

  return parDefaut();
}
