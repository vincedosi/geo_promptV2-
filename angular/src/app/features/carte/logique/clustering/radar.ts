/**
 * La géométrie des radars du clustering — `RadarChart` (`ClusterPanel.tsx:96-182`, 6 axes au plus) et `ClusterRadar`
 * (`components/ClusterRadar.tsx`, 16 axes, référence « Moy. France » en tirets). React dessinait deux fois le même SVG
 * à la main ; ici UNE fonction pure rend les chaînes du dessin (`toFixed(1)` comme React), et `mg-radar` les pose.
 *
 * Pourquoi du SVG et pas ECharts : React dessine ces radars en SVG écrit à la main (pas de Recharts) — le recopier
 * garde le rendu exact (rayons 0,33 et 0,46 de la taille, grille à 4 anneaux, légende en bas à gauche).
 */
import { libelleCourtAxe } from './libelles';

export interface OptionsRadar {
  profils: readonly Readonly<Record<string, number>>[];
  /** Une couleur CSS par profil (hexadécimal d'une donnée, ou `var(--jeton)` : le dessin passe par `style`). */
  couleurs: readonly string[];
  libelles: readonly string[];
  cles: readonly string[];
  taille: number;
  /** 6 au panneau (`RadarChart`), 16 au rapport (`ClusterRadar`). */
  maxAxes: number;
  /** Le profil national « Moy. France », tracé en tirets SOUS les profils. */
  reference?: Readonly<Record<string, number>>;
  /** `showLegend` (défaut : vrai). */
  legende?: boolean;
  /** `showRefLegend` (défaut : vrai si une référence est donnée). */
  legendeReference?: boolean;
}

export interface EtiquetteRadar {
  x: string;
  y: string;
  ancre: 'start' | 'middle' | 'end';
  base: 'auto' | 'hanging' | 'middle';
  texte: string;
}

export interface EntreeLegendeRadar {
  transform: string;
  couleur: string;
  libelle: string;
  /** La référence : un trait en tirets au lieu d'un carré. */
  tirets: boolean;
}

export interface DessinRadar {
  taille: number;
  /** Les anneaux 0,25 · 0,5 · 0,75 · 1 ; `exterieur` = le dernier (trait plus marqué). */
  grilles: { points: string; exterieur: boolean }[];
  axes: { x1: string; y1: string; x2: string; y2: string }[];
  /** Le tracé de la référence, `null` sans référence. */
  reference: string | null;
  traces: { d: string; couleur: string }[];
  etiquettes: EtiquetteRadar[];
  legende: EntreeLegendeRadar[];
}

/** La teinte de la référence « Moy. France » : le `#666666` de React, devenu un jeton (il suit le thème). */
export const COULEUR_REFERENCE = 'var(--text-tertiary)';

/** Le dessin d'un radar ; `null` sous 3 axes ou sans profil (React ne rend rien). */
export function dessinerRadar(o: OptionsRadar): DessinRadar | null {
  const n = Math.min(o.cles.length, o.maxAxes);
  const cles = o.cles.slice(0, n);
  if (n < 3 || o.profils.length === 0) return null;

  const cx = o.taille / 2;
  const cy = o.taille / 2;
  const r = o.taille * 0.33;
  const rL = o.taille * 0.46;
  const angles = cles.map((_, i) => (i / n) * 2 * Math.PI - Math.PI / 2);
  const xy = (angle: number, val: number, rayon = r) => ({ x: cx + rayon * val * Math.cos(angle), y: cy + rayon * val * Math.sin(angle) });
  const f = (v: number) => v.toFixed(1);

  // Normalisation par axe : le maximum des profils ET de la référence (0,001 au plus bas, jamais une division par 0).
  const max: Record<string, number> = {};
  for (const k of cles) {
    const valeurs = o.profils.map((p) => p[k] ?? 0);
    if (o.reference) valeurs.push(o.reference[k] ?? 0);
    max[k] = Math.max(...valeurs, 0.001);
  }
  const trace = (profil: Readonly<Record<string, number>>) => {
    const pts = cles.map((k, i) => {
      const { x, y } = xy(angles[i], Math.min(1, (profil[k] ?? 0) / max[k]));
      return `${f(x)},${f(y)}`;
    });
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
  };

  const legende: EntreeLegendeRadar[] = (o.legende ?? true)
    ? o.libelles.map((libelle, i) => ({ transform: '', couleur: o.couleurs[i], libelle, tirets: false }))
    : [];
  if (o.reference && (o.legendeReference ?? true)) legende.push({ transform: '', couleur: COULEUR_REFERENCE, libelle: 'Moy. France', tirets: true });

  return {
    taille: o.taille,
    grilles: [0.25, 0.5, 0.75, 1].map((frac) => ({
      points: cles.map((_, i) => {
        const { x, y } = xy(angles[i], frac);
        return `${f(x)},${f(y)}`;
      }).join(' '),
      exterieur: frac === 1,
    })),
    axes: cles.map((_, i) => {
      const { x, y } = xy(angles[i], 1);
      return { x1: f(cx), y1: f(cy), x2: f(x), y2: f(y) };
    }),
    reference: o.reference ? trace(o.reference) : null,
    traces: o.profils.map((p, i) => ({ d: trace(p), couleur: o.couleurs[i] })),
    etiquettes: cles.map((k, i) => {
      const { x, y } = xy(angles[i], 1, rL);
      return {
        x: f(x), y: f(y), texte: libelleCourtAxe(k),
        ancre: x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle',
        base: y < cy - 4 ? 'auto' : y > cy + 4 ? 'hanging' : 'middle',
      };
    }),
    legende: legende.map((e, i) => ({ ...e, transform: `translate(4, ${o.taille - 10 - i * 12})` })),
  };
}
