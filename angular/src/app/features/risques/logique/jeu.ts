/**
 * Jeu de zones — copie Angular de `lib/zones/jeu.ts:39-92` : constantes, type
 * écrit à la main (A12 : pas de Zod côté Angular) et `JEU_DEFAUT`. La
 * normalisation d'un jeu est faite par le serveur.
 */
import type { ProfilRayons } from './profil';

/** Les deux façons de traduire un jeu de zones en plan de campagne. */
export const MODES_PLAN = ['pondere', 'exclusif'] as const;

/** Multiplicateur d'enchère minimal. Zéro = la classe ne reçoit rien. */
export const POIDS_MIN = 0;

/**
 * Multiplicateur d'enchère maximal. Cinq, comme
 * `dsp_campaigns.overpressure_weight` dont la contrainte CHECK borne déjà à 5 :
 * un multiplicateur part vers un DSP et coûte de l'argent réel.
 */
export const POIDS_MAX = 5;

/**
 * Une clé de classe telle que `idClasse` l'écrit : `haut:pprt`, `bas:2`, ou
 * `hors`. Le motif est vérifié pour qu'une clé fantaisiste ne survive pas à
 * l'enregistrement.
 */
export const MOTIF_CLASSE = /^(haut|bas|autres):(pprt|[1-4])$|^hors$/;

/** Équivalent de `z.infer<typeof JeuDeZonesSchema>` côté React. */
export interface JeuDeZones {
  profil: ProfilRayons;
  /** Code de la cible comptée, validé contre `cibles_exposition` côté serveur. */
  cible: string;
  /** Gravités retenues, telles que `poi_france.sous_categorie` les écrit. */
  gravites: string[];
  /** Natures de risque retenues. Vide = toutes. */
  natures: string[];
  /** Origine de la zone retenue autour d'un site. */
  modes: ('pprt' | 'buffer')[];
  /** Code de département, ou `null` pour la France entière. */
  territoire: string | null;
  mode_plan: (typeof MODES_PLAN)[number];
  /** Pourcentage de 0 à 100 (pas une fraction). */
  seuil_couverture_cp: number;
  /** Multiplicateur d'enchère par classe. Absent = 1. */
  poids: Record<string, number>;
}

/**
 * Le jeu ouvert par défaut.
 *
 * `seuil_couverture_cp` à 20 : en dessous, on achète surtout du hors-cible ;
 * au-dessus, le plan se vide sur les zones rurales où un site isolé ne couvre
 * jamais un cinquième de son code postal.
 */
export const JEU_DEFAUT: JeuDeZones = {
  profil: { haut: [1000, 2000, 5000], bas: [500, 1000], autres: [], lie: false, inclurePPRT: true },
  cible: 'ind',
  gravites: ['seveso_bas', 'seveso_haut'],
  natures: [],
  modes: ['buffer', 'pprt'],
  territoire: null,
  mode_plan: 'pondere',
  seuil_couverture_cp: 20,
  poids: {},
};
