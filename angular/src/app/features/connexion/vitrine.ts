/**
 * Texte de VITRINE de la connexion — statique, recopié de `app/login/page.tsx:367-407`
 * tel que React l'affiche (arbitrage 5 du lot Rendu).
 *
 * ⚠ Dette signalée : ces chiffres sont écrits en dur côté React, ils ne sont ni mesurés ni
 * tenus à jour (« 49K zones IRIS » : 49 448 en base ; « 2.3M carreaux » : 2 324 577 ; « 285K
 * arrêts » et « 3.9K panneaux » non vérifiés). On les reprend pour la parité du rendu ; les
 * relire est un sujet produit, pas un sujet de portage.
 */
export const VITRINE = {
  titre: 'Intelligence OOH en temps réel',
  accroche: '49 000 zones IRIS, 2.3M carreaux INSEE, isochrones multi-modaux — le tout piloté par IA.',
  chiffres: [
    { valeur: '49K', libelle: 'zones IRIS' },
    { valeur: '2.3M', libelle: 'carreaux' },
    { valeur: '285K', libelle: 'arrêts' },
    { valeur: '3.9K', libelle: 'panneaux' },
  ],
} as const;

/** Centres des 14 hexagones de la grille de la vitrine (`app/login/page.tsx:335-342`). */
const CENTRES = [
  { x: 130, y: 80 },
  { x: 100, y: 98 }, { x: 160, y: 98 },
  { x: 70, y: 116 }, { x: 130, y: 116 }, { x: 190, y: 116 },
  { x: 100, y: 134 }, { x: 160, y: 134 },
  { x: 70, y: 152 }, { x: 130, y: 152 }, { x: 190, y: 152 },
  { x: 100, y: 170 }, { x: 160, y: 170 },
  { x: 130, y: 188 },
] as const;

/** Rang des hexagones d'accent (teal) et intermédiaires (`page.tsx:344-345`). */
const ACCENTS: readonly number[] = [0, 4, 9, 13];
const MILIEU: readonly number[] = [2, 5, 7, 11];

/** Sommets d'un hexagone à pointe en haut, rayon `r` (`hexPoints`, `page.tsx:28-33`). */
function pointsHexagone(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
}

export interface HexagoneGrille {
  readonly x: number;
  readonly y: number;
  readonly points: string;
  readonly accent: boolean;
  readonly milieu: boolean;
  /** Retard d'apparition en secondes (`i * 0.06`, `page.tsx:347`). */
  readonly retard: number;
}

export const GRILLE: readonly HexagoneGrille[] = CENTRES.map((c, i) => ({
  ...c,
  points: pointsHexagone(c.x, c.y, 14),
  accent: ACCENTS.includes(i),
  milieu: MILIEU.includes(i),
  retard: i * 0.06,
}));
