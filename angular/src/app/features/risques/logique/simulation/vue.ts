/**
 * Ce que l'étape ⑤ affiche, calculé à partir de la réponse de
 * `GET /api/zones/jeux/[id]/simulation` — fonctions PURES.
 *
 * L'écran ET l'export Excel lisent ces fonctions : un classeur qui recalculerait
 * autrement finirait par contredire l'écran, et c'est le tableur qu'on croirait.
 */
import { alignementParZone, cibleParZone, RAISON_NON_CALCULABLE } from './alignement';
import type { ReponseSimulation, EntreeBrute, ZoneSimulation } from './payload';
import { versCpSimulation } from './entrees';

export type Periode = 'v1' | 'v2' | 'tout';

export const LIBELLE_PERIODE: Record<Periode, string> = {
  v1: 'Semaines 1-2 · v1',
  v2: 'Semaines 3-4 · v2',
  tout: 'Toute la campagne',
};

/** Les jours d'une période, bornes incluses. */
function joursDeLaPeriode(
  sim: { jours: number; jour_recalage: number },
  periode: Periode,
): [number, number] {
  if (periode === 'v1') return [1, sim.jour_recalage - 1];
  if (periode === 'v2') return [sim.jour_recalage, sim.jours];
  return [1, sim.jours];
}

interface Indicateurs {
  impressions: number;
  utiles: number;
  en_zone: number;
  depense: number;
  /** Le score 0-100, ou `null` avec sa raison : jamais un 100 par défaut. */
  score: number | null;
  raison: string | null;
  /** Part des impressions sur des codes postaux achetés en zone, de 0 à 1. */
  part_en_zone: number | null;
  /** Part des impressions qui touchent des habitants exposés, de 0 à 1. */
  taux_utile_reel: number | null;
  /** Habitants exposés touchés au moins une fois (estimation de portée). */
  exposes_touches: number;
  cout_expose_touche: number | null;
}

export interface LigneZone {
  id: string;
  nom: string;
  rang: number;
  n_sites: number;
  pop_exposee: number;
  part_plan: number;
  part_diffusee: number;
  indice: number | null;
  impressions: number;
  utiles: number;
  depense: number;
  taux_utile: number | null;
  exposes_touches: number;
  cout_expose_touche: number | null;
  bbox: [number, number, number, number] | null;
}

interface LigneCp {
  code_postal: string;
  cluster_id: string | null;
  impressions: number;
  utiles: number;
  depense: number;
  /** Acheté en zone sur le plan de la période. */
  achete: boolean;
  /** Part diffusée ÷ part du plan × 100, ou `null` hors plan. */
  indice: number | null;
  x: number | null;
  y: number | null;
}

interface LignePartenaire {
  nom: string;
  impressions: number;
  depense: number;
  cpm: number | null;
  part_en_zone: number | null;
  taux_utile: number | null;
}

export interface VueSimulation {
  periode: Periode;
  jours: [number, number];
  indicateurs: Indicateurs;
  zones: LigneZone[];
  cps: LigneCp[];
  partenaires: LignePartenaire[];
}

/**
 * Portée estimée : habitants touchés au moins une fois, loi de Poisson.
 *
 * `pop × (1 − e^(−utiles/pop))` : avec autant d'impressions utiles que
 * d'habitants, on en touche 63 %, pas 100 %. Diviser la dépense par la
 * population exposée ENTIÈRE rendait 0,00 € — un coût qui ne dit rien.
 */
function portee(pop: number, utiles: number): number {
  if (pop <= 0 || utiles <= 0) return 0;
  return pop * (1 - Math.exp(-utiles / pop));
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Le plan de chaque code postal pour une période, en part de 0 à 1. */
function partsDuPlan(
  entrees: EntreeBrute[],
  mult2: Record<string, number> | undefined,
  sim: { jours: number; jour_recalage: number },
  periode: Periode,
): Map<string, number> {
  const parts = (m: Map<string, number>) => {
    const s = [...m.values()].reduce((t, v) => t + v, 0);
    return new Map([...m].map(([k, v]) => [k, s > 0 ? v / s : 0]));
  };
  const p1 = parts(new Map(entrees.map((e) => [e.code_postal, e.multiplicateur])));
  if (periode === 'v1' || !mult2) return p1;
  const p2 = parts(new Map(Object.entries(mult2)));
  if (periode === 'v2') return p2;
  // Toute la campagne : chaque plan pèse ses jours.
  const n1 = sim.jour_recalage - 1;
  const n2 = sim.jours - n1;
  const cles = new Set([...p1.keys(), ...p2.keys()]);
  return new Map([...cles].map((k) => [k, ((p1.get(k) ?? 0) * n1 + (p2.get(k) ?? 0) * n2) / (n1 + n2)]));
}

/**
 * La vue d'une période.
 *
 * @returns `null` si la réponse ne porte pas de simulation.
 */
export function construireVue(rep: ReponseSimulation, periode: Periode): VueSimulation | null {
  const sim = rep.simulation;
  if (!sim || !rep.entrees || !rep.agregats || !rep.zones) return null;
  // Une période v2 sans recalage n'a rien à montrer : on retombe sur la v1.
  const p: Periode = periode === 'v2' && sim.statut !== 'v2' ? 'v1' : periode;
  const [a, b] = joursDeLaPeriode(sim, p);
  const versions = p === 'v1' ? [1] : p === 'v2' ? [2] : [1, 2];

  const entrees = rep.entrees;
  const parCode = new Map(entrees.map((e) => [e.code_postal, e]));
  const cps = entrees.map(versCpSimulation);
  const cible = cibleParZone(cps);

  // Codes postaux : impressions de la période, et plan de la période.
  const achatV1 = new Set(entrees.filter((e) => e.retenu).map((e) => e.code_postal));
  const planPart = partsDuPlan(entrees, rep.multiplicateurs_v2, sim, p);
  const agregCp = new Map<string, { imps: number; utiles: number; spend: number }>();
  for (const r of rep.agregats.par_cp) {
    if (!versions.includes(r.v)) continue;
    const o = agregCp.get(r.cp) ?? { imps: 0, utiles: 0, spend: 0 };
    o.imps += Number(r.imps); o.utiles += Number(r.utiles); o.spend += Number(r.spend);
    agregCp.set(r.cp, o);
  }
  const totImps = [...agregCp.values()].reduce((t, o) => t + o.imps, 0);
  const lignesCp: LigneCp[] = [...new Set([...agregCp.keys(), ...planPart.keys()])].map((code) => {
    const o = agregCp.get(code) ?? { imps: 0, utiles: 0, spend: 0 };
    const e = parCode.get(code);
    const plan = planPart.get(code) ?? 0;
    return {
      code_postal: code,
      cluster_id: e?.cluster_id ?? null,
      impressions: o.imps,
      utiles: o.utiles,
      depense: o.spend,
      achete: achatV1.has(code),
      indice: plan > 0 && totImps > 0 ? ((o.imps / totImps) / plan) * 100 : null,
      x: e?.x ?? null,
      y: e?.y ?? null,
    };
  });

  // Zones : impressions utiles de la période, par bassin.
  const agregZone = new Map<string, { imps: number; utiles: number; spend: number }>();
  for (const r of rep.agregats.par_zone_jour) {
    if (r.jour < a || r.jour > b) continue;
    const o = agregZone.get(r.cid) ?? { imps: 0, utiles: 0, spend: 0 };
    o.imps += Number(r.imps); o.utiles += Number(r.utiles); o.spend += Number(r.spend);
    agregZone.set(r.cid, o);
  }
  const al = alignementParZone(new Map([...agregZone].map(([k, o]) => [k, o.utiles])), cible);
  const alParZone = new Map(al.zones.map((z) => [z.cluster_id, z]));
  const zones: LigneZone[] = rep.zones.map((z: ZoneSimulation) => {
    const o = agregZone.get(z.id) ?? { imps: 0, utiles: 0, spend: 0 };
    const x = alParZone.get(z.id);
    const touches = portee(z.pop_exposee, o.utiles);
    return {
      id: z.id, nom: z.nom, rang: z.rang, n_sites: z.n_sites, pop_exposee: z.pop_exposee,
      part_plan: x?.part_plan ?? 0,
      part_diffusee: x?.part_diffusee ?? 0,
      indice: x?.indice ?? null,
      impressions: o.imps, utiles: o.utiles, depense: o.spend,
      taux_utile: ratio(o.utiles, o.imps),
      exposes_touches: touches,
      cout_expose_touche: touches > 0 ? o.spend / touches : null,
      bbox: z.bbox,
    };
  });

  // Indicateurs de la période.
  const jours = rep.agregats.par_jour.filter((j) => j.jour >= a && j.jour <= b);
  const somme = (f: (j: (typeof jours)[number]) => number) => jours.reduce((t, j) => t + Number(f(j)), 0);
  const impressions = somme((j) => j.imps);
  const utiles = somme((j) => j.utiles);
  const enZone = somme((j) => j.en_zone);
  const depense = somme((j) => j.spend);
  const touches = zones.reduce((t, z) => t + z.exposes_touches, 0);

  // Partenaires.
  const agregPart = new Map<string, { imps: number; spend: number; en_zone: number; utiles: number }>();
  for (const r of rep.agregats.par_partenaire) {
    if (!versions.includes(r.v)) continue;
    const o = agregPart.get(r.partenaire) ?? { imps: 0, spend: 0, en_zone: 0, utiles: 0 };
    o.imps += Number(r.imps); o.spend += Number(r.spend);
    o.en_zone += Number(r.en_zone); o.utiles += Number(r.utiles);
    agregPart.set(r.partenaire, o);
  }
  const partenaires: LignePartenaire[] = [...agregPart]
    .map(([nom, o]) => ({
      nom, impressions: o.imps, depense: o.spend,
      cpm: o.imps > 0 ? (o.spend / o.imps) * 1000 : null,
      part_en_zone: ratio(o.en_zone, o.imps),
      taux_utile: ratio(o.utiles, o.imps),
    }))
    .sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));

  return {
    periode: p,
    jours: [a, b],
    indicateurs: {
      impressions, utiles, en_zone: enZone, depense,
      score: al.calculable ? al.score : null,
      raison: al.calculable ? null : RAISON_NON_CALCULABLE[al.raison],
      part_en_zone: ratio(enZone, impressions),
      taux_utile_reel: ratio(utiles, impressions),
      exposes_touches: touches,
      cout_expose_touche: touches > 0 ? depense / touches : null,
    },
    zones,
    cps: lignesCp,
    partenaires,
  };
}

/** Un point de la courbe d'alignement : un jour, sa version, son score. */
export interface PointCourbe {
  jour: number;
  version: 1 | 2;
  score: number | null;
}

/** L'alignement jour par jour, sur la population exposée. */
export function courbeAlignement(rep: ReponseSimulation): PointCourbe[] {
  const sim = rep.simulation;
  if (!sim || !rep.entrees || !rep.agregats) return [];
  const cible = cibleParZone(rep.entrees.map(versCpSimulation));
  const parJour = new Map<number, Map<string, number>>();
  for (const r of rep.agregats.par_zone_jour) {
    const m = parJour.get(r.jour) ?? new Map<string, number>();
    m.set(r.cid, (m.get(r.cid) ?? 0) + Number(r.utiles));
    parJour.set(r.jour, m);
  }
  const fin = sim.statut === 'v2' ? sim.jours : sim.jour_recalage - 1;
  const out: PointCourbe[] = [];
  for (let j = 1; j <= fin; j++) {
    const al = alignementParZone(parJour.get(j) ?? new Map(), cible);
    out.push({ jour: j, version: j < sim.jour_recalage ? 1 : 2, score: al.calculable ? al.score : null });
  }
  return out;
}

/** Une zone à corriger, chiffrée. */
interface ConstatZone {
  id: string;
  nom: string;
  indice: number;
  /** Impressions à redéployer (sur-pression) ou manquantes (sous-pression). */
  impressions: number;
  /** Euros correspondants, au CPM réel de la zone. */
  euros: number;
}

export interface Constats {
  sur: ConstatZone[];
  sous: ConstatZone[];
  dilues: { code_postal: string; part_en_zone: number; impressions: number }[];
}

/**
 * « Ce qu'il faut corriger » : toujours chiffré, jamais un adjectif.
 *
 * Seuil de signalement : l'indice sort de la tolérance de 10 %, la même que le
 * score. Un constat qu'on signale sans qu'il pèse sur le score serait du bruit.
 */
export function constats(vue: VueSimulation, entrees: EntreeBrute[], max = 3): Constats {
  const tot = vue.zones.reduce((t, z) => t + z.utiles, 0);
  const avecIndice = vue.zones.filter((z) => z.indice != null && z.part_plan > 0);
  const chiffrer = (z: LigneZone, utilesEcart: number): ConstatZone => {
    // Des impressions UTILES en écart, ramenées en impressions brutes par le
    // taux d'utile de la zone, puis en euros par son CPM réel.
    const imps = z.taux_utile && z.taux_utile > 0 ? utilesEcart / z.taux_utile : utilesEcart;
    const cpm = z.impressions > 0 ? (z.depense / z.impressions) * 1000 : 0;
    return { id: z.id, nom: z.nom, indice: z.indice!, impressions: imps, euros: (imps / 1000) * cpm };
  };
  const sur = avecIndice
    .filter((z) => z.indice! > 110)
    .sort((x, y) => y.indice! - x.indice!)
    .slice(0, max)
    .map((z) => chiffrer(z, z.utiles - z.part_plan * tot));
  const sous = avecIndice
    .filter((z) => z.indice! < 90)
    .sort((x, y) => (y.part_plan * tot - y.utiles) - (x.part_plan * tot - x.utiles))
    .slice(0, max)
    .map((z) => chiffrer(z, z.part_plan * tot - z.utiles));

  const parCode = new Map(entrees.map((e) => [e.code_postal, e]));
  const dilues = vue.cps
    .filter((c) => c.achete && c.impressions > 0)
    .map((c) => ({ c, part: parCode.get(c.code_postal)?.part_en_zone ?? 100 }))
    .sort((x, y) => x.part - y.part || y.c.impressions - x.c.impressions)
    .slice(0, max)
    .map(({ c, part }) => ({ code_postal: c.code_postal, part_en_zone: part, impressions: c.impressions }));

  return { sur, sous, dilues };
}

/**
 * La couleur d'un site : la pression reçue par son bassin.
 *
 * Rouge sous 50 (le bassin reçoit moins de la moitié de sa part), orange de 50
 * à 90, vert au-delà — un site en sur-pression est SERVI, il n'est pas en
 * danger de ne pas l'être.
 */
export function etatSite(indice: number | null): 'sous_servi' | 'partiel' | 'servi' | 'inconnu' {
  if (indice == null) return 'inconnu';
  if (indice < 50) return 'sous_servi';
  if (indice < 90) return 'partiel';
  return 'servi';
}
