/**
 * Logique PURE du panneau de l'étape ⑤ (`etapes/campagne/panneau-campagne.component.ts`) : les réglages de la
 * diffusion et leurs valeurs initiales, le style des boutons, et les lignes de chaque bloc (bilan avant / après, ce
 * qu'il faut corriger, partenaires, sites sous-servis). Sortie du composant au lot 4 (T22) pour se tester sans
 * TestBed ; les CHIFFRES viennent tous de `simulation/vue.ts`, ce module ne fait que les mettre en mots.
 */
import { formaterDecimal, formaterNombre, formaterNombreCourt } from '../../../core/format/nombre';
import type { ReglagesSimulation } from '../data/simulation.api';
import { PARAMS_DEFAUT } from './simulation/parametres';
import type { EntreeBrute, ReponseSimulation } from './simulation/payload';
import { type Periode, type VueSimulation, constats, construireVue, etatSite } from './simulation/vue';

/** Un réglage de la diffusion, ses bornes et son format (`PanneauCampagne.tsx:40-50`, MOT POUR MOT). */
export interface Reglage {
  cle: keyof ReglagesSimulation;
  libelle: string;
  min: number;
  max: number;
  pas: number;
  format: (v: number) => string;
}

export const REGLAGES: readonly Reglage[] = [
  { cle: 'budget', libelle: 'Budget', min: 20_000, max: 1_000_000, pas: 10_000, format: (v) => `${formaterNombre(v)} €` },
  { cle: 'intensite', libelle: 'Effet inventaire', min: 1, max: 2.2, pas: 0.05, format: (v) => formaterDecimal(v, 2) },
  { cle: 'fuite', libelle: 'Fuite hors zone', min: 0, max: 0.15, pas: 0.005, format: (v) => `${formaterDecimal(v * 100, 1)} %` },
  { cle: 'bruit', libelle: 'Bruit journalier', min: 0, max: 0.5, pas: 0.02, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'amortissement', libelle: 'Force du recalage', min: 0, max: 1, pas: 0.05, format: (v) => `${formaterDecimal(v * 100, 0)} %` },
  { cle: 'graine', libelle: 'Graine', min: 1, max: 99_999, pas: 1, format: (v) => String(v) },
];

/** Les réglages initiaux (`PanneauCampagne.tsx:52-59`) : la graine ramenée sous le maximum du curseur. */
export const DEFAUTS: ReglagesSimulation = {
  budget: PARAMS_DEFAUT.budget,
  intensite: PARAMS_DEFAUT.intensite,
  fuite: PARAMS_DEFAUT.fuite,
  bruit: PARAMS_DEFAUT.bruit,
  amortissement: PARAMS_DEFAUT.amortissement,
  graine: PARAMS_DEFAUT.graine % 100_000,
};

export const PERIODES: readonly Periode[] = ['v1', 'v2', 'tout'];

/** Une part en pourcentage à une décimale, « — » si absente. */
export const pct = (x: number | null | undefined): string => (x == null ? '—' : `${formaterDecimal(x * 100, 1)} %`);

/** Les lignes du bilan avant / après (`Bilan`, `PanneauCampagne.tsx:327-360`). */
const LIGNES_BILAN: readonly [string, (v: VueSimulation) => string][] = [
  ['Alignement', (v) => (v.indicateurs.score == null ? 'non calculable' : String(Math.round(v.indicateurs.score)))],
  ['Part en zone', (v) => pct(v.indicateurs.part_en_zone)],
  ['Taux d’utile', (v) => pct(v.indicateurs.taux_utile_reel)],
  ['Coût par exposé touché', (v) => (v.indicateurs.cout_expose_touche == null ? '—' : `${formaterDecimal(v.indicateurs.cout_expose_touche, 3)} €`)],
];

const BOUTON = 'inline-flex items-center gap-[6px] rounded-[6px] border-fin bg-transparent px-3 py-[6px] text-[12px] font-medium';

/** Le style d'un bouton du panneau (`styleBouton`, `PanneauCampagne.tsx:537-546`) : teal s'il est principal. */
export function classeBouton(principal: boolean, desactive: boolean): string {
  return `${BOUTON} ${principal ? 'border-teal text-teal' : 'border-default text-secondary'} ${desactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`;
}

/** Le bilan avant / après, TOUJOURS sur v1 et v2, quelle que soit la période choisie. `null` sans v1. */
export function lignesBilan(r: ReponseSimulation | null): { nom: string; v1: string; v2: string }[] | null {
  const a = r ? construireVue(r, 'v1') : null;
  if (!r || !a) return null;
  const b = r.simulation?.statut === 'v2' ? construireVue(r, 'v2') : null;
  return LIGNES_BILAN.map(([nom, f]) => ({ nom, v1: f(a), v2: b ? f(b) : '—' }));
}

/** « Ce qu'il faut corriger » : sur- et sous-pression (noms, impressions, euros), puis les codes postaux dilués. */
export function blocsACorriger(v: VueSimulation, entrees: EntreeBrute[]) {
  const c = constats(v, entrees);
  type Ligne = (typeof c.sur)[number];
  const noms = (l: Ligne[]) => l.map((z) => `${z.nom} (${Math.round(z.indice)})`).join(', ');
  const somme = (l: Ligne[], k: 'impressions' | 'euros') => l.reduce((t, z) => t + z[k], 0);
  const bloc = (l: Ligne[]) => (l.length === 0 ? null : {
    noms: noms(l),
    impressions: formaterNombreCourt(Math.round(somme(l, 'impressions'))),
    euros: formaterNombre(Math.round(somme(l, 'euros'))),
  });
  return {
    aucun: c.sur.length === 0 && c.sous.length === 0,
    sur: bloc(c.sur),
    sous: bloc(c.sous),
    dilues: c.dilues.length === 0 ? null
      : c.dilues.map((d) => `${d.code_postal} (${formaterDecimal(d.part_en_zone, 1)} % d’exposés)`).join(', '),
  };
}

/** Le tableau des partenaires de la période, mis en forme. */
export function lignesPartenaires(v: VueSimulation | null) {
  return (v?.partenaires ?? []).map((p) => ({
    nom: p.nom,
    impressions: formaterNombreCourt(p.impressions),
    cpm: p.cpm == null ? '—' : `${formaterDecimal(p.cpm, 2)} €`,
    partEnZone: pct(p.part_en_zone),
    tauxUtile: pct(p.taux_utile),
  }));
}

/** Les bassins qui reçoivent moins de 90 % de leur part du plan, du plus mal servi au moins mal ; huit au plus. */
export function sitesSousServis(v: VueSimulation) {
  const sous = v.zones
    .filter((z) => z.part_plan > 0 && etatSite(z.indice) !== 'servi')
    .sort((a, b) => (a.indice ?? 0) - (b.indice ?? 0));
  return {
    nSites: formaterNombre(sous.reduce((t, z) => t + z.n_sites, 0)),
    nBassins: formaterNombre(sous.length),
    zones: sous.slice(0, 8).map((z) => ({
      id: z.id,
      nom: z.nom,
      sites: `${formaterNombre(z.n_sites)} site${z.n_sites > 1 ? 's' : ''}`,
      indice: z.indice == null ? '—' : String(Math.round(z.indice)),
    })),
  };
}
