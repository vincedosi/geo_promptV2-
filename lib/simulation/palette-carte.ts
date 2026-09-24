/**
 * Les couleurs de la carte de l'étape ⑤, en LITTÉRAUX.
 *
 * ⚠ MapLibre ne résout pas `var()` dans `paint` : `addLayer` lève, la couche
 * n'est jamais ajoutée, et rien ne le signale (piège déjà payé sur la carte des
 * sites à risque). Chaque valeur ci-dessous est donc le MIROIR d'un jeton de
 * `app/globals.css`, indexé par thème, et c'est le seul endroit du module où
 * une couleur s'écrit en hexadécimal.
 *
 * L'échelle de pression, elle, n'est pas redéclarée : c'est `RAMPE_MAPLIBRE`
 * de `lib/campagne/palette-divergente.ts`, la même que le Suivi.
 */
export type Theme = 'dark' | 'light';

/** Miroir de `--brand-teal` : invariant, comme l'accent de marque. */
export const TEAL = '#4ecdc4';

/** Cercles de fuite hors plan — miroir de `--text-tertiary`. */
export const GRIS_FUITE: Record<Theme, string> = { dark: '#8a8a8a', light: '#8a8a8a' };

/** Contour des cercles et des sites — miroir de `--halo-carte`, inversé entre thèmes. */
export const HALO: Record<Theme, string> = {
  dark: 'rgba(0,0,0,0.75)',
  light: 'rgba(255,255,255,0.85)',
};

/** Contour des bassins — miroir de `--contour-carte`. */
export const CONTOUR: Record<Theme, string> = {
  dark: 'rgba(255,255,255,0.16)',
  light: 'rgba(0,0,0,0.22)',
};

/** Contour de la zone sélectionnée — miroir de `--text-primary`. */
export const CONTOUR_ACTIF: Record<Theme, string> = { dark: '#f0f0f0', light: '#1a1a1a' };

/**
 * L'état d'un site selon la pression reçue par son bassin — miroirs de
 * `--success`, `--warning` et `--danger`, les seules couleurs sémantiques
 * autorisées par le design system.
 */
export const COULEUR_ETAT_SITE: Record<Theme, Record<'servi' | 'partiel' | 'sous_servi' | 'inconnu', string>> = {
  dark: { servi: '#3dffa0', partiel: '#f7b731', sous_servi: '#ff5757', inconnu: '#8a8a8a' },
  light: { servi: '#0fa958', partiel: '#c08400', sous_servi: '#d4202f', inconnu: '#8a8a8a' },
};

/**
 * Étiquettes des bassins. Invariantes : le fond Positron est clair dans les
 * deux thèmes (même choix que la carte des codes postaux), donc un texte
 * foncé sur halo clair s'y lit toujours — miroir de `--text-primary` du thème
 * clair et de `--halo-carte` clair.
 */
export const TEXTE_ETIQUETTE = '#1a1a1a';
export const HALO_ETIQUETTE = 'rgba(255,255,255,0.9)';
