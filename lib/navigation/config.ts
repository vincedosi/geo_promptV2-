/**
 * @file lib/navigation/config.ts — source unique de la navigation de /map
 *
 * Chaine mentale : Filtre -> Calques -> Analyse -> Zones -> Campagne.
 *   Filtre   : ou je regarde. Restreint l'affichage et allege les requetes.
 *   Calques  : ce que je vois. Affiche des donnees, ne fabrique rien.
 *   Analyse  : ce que je calcule. Produit un calque, une zone candidate, un rapport.
 *   Zones    : ce que je fabrique. Seul endroit qui cree de la geometrie et une liste de CP.
 *   Campagne : ce que j'active. Overlay plein ecran.
 *
 * L'entree « Assistant » (Ctrl+K, tiroir droit du chat IA) est retiree depuis
 * le 2026-10-12 (chantier « suppression de toute l'IA », lot 5) : AIDA, le
 * shell dentsu, porte l'IA. Ctrl+K n'ouvre plus rien.
 *
 * AUCUN composant ne redeclare un id, un label, une icone ou un raccourci :
 * ils lisent ce fichier. Verrouille par tests/unit/navigation/config.test.ts.
 */
import {
  Megaphone, Funnel, Layers, FlaskConical, Shapes, Settings, CircleHelp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Les quatre outils qui ouvrent un panneau gauche.
 * Non exporte : aucun consommateur externe (verifie par `npm run catalogue`) —
 * seul `EntreeId` en a besoin, dans ce fichier.
 */
type PanneauId = 'filtre' | 'calques' | 'analyse' | 'zones';

/** Toutes les entrees du rail. */
export type EntreeId = 'campagne' | PanneauId | 'reglages' | 'aide';

/**
 * Ou et comment s'ouvre le contenu d'une entree.
 * Non exporte : consomme uniquement par `EntreeNavigation.type` ci-dessous.
 */
type TypePanneau =
  | 'panneau-gauche'        // Les quatre outils : OverlayPanel a gauche
  | 'overlay-plein-ecran'   // Campagne : overlay MAGELIAN par-dessus la carte
  | 'lien';                 // Reglages, Aide

export interface EntreeNavigation {
  id: EntreeId;
  label: string;
  icone: LucideIcon;
  /** Phrase affichee au survol. Vide pour les entrees sans question associee. */
  tooltip: string;
  type: TypePanneau;
  /** Forme canonique du raccourci : 'alt+1', 'alt+c'... */
  raccourci?: string;
  position: 'haut' | 'bas';
  /** Filet de separation APRES cette entree. */
  separateurApres?: boolean;
  /** Traitement visuel distinct : bouton pleine largeur en fond teal. */
  accent?: boolean;
}

/**
 * Largeur du rail, en pixels. Etait a 48, ce qui tronquait « Perimetre » a
 * huit caracteres (« Perimetr »). Toute position calee sur le rail doit lire
 * cette constante, jamais un 48 ou un 56 en dur.
 */
export const LARGEUR_RAIL = 76;

/** Ecart entre le rail et le panneau qu'il ouvre. */
export const ECART_RAIL_PANNEAU = 8;

/**
 * Largeur des quatre panneaux du rail (Filtre / Calques / Analyse / Zones).
 *
 * Etait a 280, en dur dans `components/map/OverlayPanel.tsx`. A cette largeur,
 * la section « Zones a risque industriel » faisait deborder ses six boutons de
 * rayon sur deux lignes et ouvrait une BARRE DE DEFILEMENT HORIZONTALE en bas
 * du panneau — le symptome le plus net qu'une largeur ne suffit plus.
 *
 * 340 est la valeur ou ces six boutons tiennent sur une ligne et ou
 * « Perimetre reglementaire » ne se tronque plus, tout en restant sous le
 * quart d'un ecran 1440. Elle vaut pour LES QUATRE panneaux : ils partagent
 * `OverlayPanel`, et en elargir un seul creerait un saut de largeur a chaque
 * bascule d'outil.
 *
 * Toute largeur calee sur le panneau lit cette constante, jamais un 280 en
 * dur — meme regle que `LARGEUR_RAIL`.
 */
export const LARGEUR_PANNEAU = 340;

export const ENTREES_NAVIGATION: readonly EntreeNavigation[] = [
  {
    id: 'campagne', label: 'Campagne', icone: Megaphone,
    tooltip: "Ce que j’active", type: 'overlay-plein-ecran',
    raccourci: 'alt+c', position: 'haut', separateurApres: true, accent: true,
  },
  {
    id: 'filtre', label: 'Filtre', icone: Funnel,
    tooltip: 'Où je regarde', type: 'panneau-gauche',
    raccourci: 'alt+1', position: 'haut',
  },
  {
    id: 'calques', label: 'Calques', icone: Layers,
    tooltip: 'Ce que je vois', type: 'panneau-gauche',
    raccourci: 'alt+2', position: 'haut',
  },
  {
    id: 'analyse', label: 'Analyse', icone: FlaskConical,
    tooltip: 'Ce que je calcule', type: 'panneau-gauche',
    raccourci: 'alt+3', position: 'haut',
  },
  {
    id: 'zones', label: 'Zones', icone: Shapes,
    tooltip: 'Ce que je fabrique', type: 'panneau-gauche',
    raccourci: 'alt+4', position: 'haut',
  },
  {
    id: 'reglages', label: 'Réglages', icone: Settings,
    tooltip: '', type: 'panneau-gauche', position: 'bas',
  },
  {
    id: 'aide', label: 'Aide', icone: CircleHelp,
    tooltip: '', type: 'panneau-gauche', position: 'bas',
  },
] as const;

/** Index raccourci canonique -> entree, construit une fois. */
const PAR_RACCOURCI: ReadonlyMap<string, EntreeId> = new Map(
  ENTREES_NAVIGATION.filter(e => e.raccourci).map(e => [e.raccourci as string, e.id]),
);

/**
 * Traduit un evenement clavier en entree de navigation.
 * Verifie exactement les modificateurs : rejette Shift toujours, rejette les combinaisons.
 * Rend null si aucun modificateur, pour ne jamais voler une frappe de saisie.
 */
export function entreeParRaccourci(e: KeyboardEvent): EntreeId | null {
  // Rejette Shift toujours
  if (e.shiftKey) return null;

  // Rejette si Ctrl ET Meta ensemble
  if (e.ctrlKey && e.metaKey) return null;

  // Un modificateur "ctrl" (ctrlKey ou metaKey, pas les deux)
  const hasCtrl = e.ctrlKey || e.metaKey;

  // Rejette si un modificateur ctrl ET Alt ensemble
  if (hasCtrl && e.altKey) return null;

  // Aucun modificateur → null
  if (!hasCtrl && !e.altKey) return null;

  const prefixe = hasCtrl ? 'ctrl+' : 'alt+';
  return PAR_RACCOURCI.get(prefixe + e.key.toLowerCase()) ?? null;
}
