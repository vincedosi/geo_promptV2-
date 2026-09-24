/**
 * Le générateur de diffusion simulée — fonctions PURES, graine fixe.
 *
 * ── CE QU'IL MODÉLISE ─────────────────────────────────────────────────────
 *
 * Une campagne qui achète au CODE POSTAL, sur le plan d'une extraction :
 *
 *   diffusion(cp, jour) ∝ plan(cp) × (densité du cp / densité de référence)^(intensité − 1)
 *                         × dérive lente du bassin × bruit journalier
 *
 * puis renormalisée au volume du jour, plus une FUITE vers les codes postaux
 * hors zone. C'est l'« effet inventaire » : l'offre publicitaire abonde là où
 * les gens vivent serrés, et une campagne pilotée au multiplicateur y part
 * plus vite que prévu, pendant que les bassins ruraux restent sous-servis.
 *
 * ⚠ **Aucune valeur de score n'est écrite ici.** L'alignement bas en v1 puis
 * haut en v2 découle de ce modèle et du recalage (`recalage.ts`) : si l'on
 * change l'intensité ou la force du recalage, les scores bougent, et c'est
 * voulu.
 *
 * ── REPRODUCTIBLE ─────────────────────────────────────────────────────────
 *
 * Tout l'aléa passe par `mulberry32` (`lib/demo/rng.ts`), dérivé de la graine
 * ET du jour : générer les jours 15 à 28 après coup rend exactement ce qu'une
 * génération d'une traite aurait rendu pour ces jours-là.
 */
import { mulberry32, hashStr } from '@/lib/demo/rng';
import type { CpSimulation, LigneDiffusion, ParamsSimulation } from '@/lib/simulation/types';

/** Les réglages par défaut, ceux du brief et de la maquette validée. */
export const PARAMS_DEFAUT: ParamsSimulation = {
  jours: 28,
  jourRecalage: 15,
  budget: 250_000,
  intensite: 1.55,
  fuite: 0.04,
  bruit: 0.18,
  derive: 0.12,
  amortissement: 0.8,
  seuilDilution: 20,
  baisseDilues: 0.6,
  graine: 20_260_924,
  // Trois partenaires génériques, à CPM distincts entre 4 et 11 € : jamais un
  // nom de régie réel dans un jeu de démonstration.
  partenaires: [
    { nom: 'Partenaire A', cpm: 4.2, part: 0.45 },
    { nom: 'Partenaire B', cpm: 7.6, part: 0.35 },
    { nom: 'Partenaire C', cpm: 10.8, part: 0.20 },
  ],
};

/** Un tirage gaussien centré réduit (Box-Muller). */
function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Le flux aléatoire d'un jour : dérivé de la graine ET du jour, jamais partagé. */
function fluxDuJour(graine: number, jour: number, canal: string): () => number {
  return mulberry32((graine ^ hashStr(`${canal}:${jour}`)) >>> 0);
}

/** Le CPM moyen pondéré par les parts de budget. */
function cpmMoyen(P: ParamsSimulation): number {
  const s = P.partenaires.reduce((t, p) => t + p.part, 0);
  return P.partenaires.reduce((t, p) => t + p.cpm * p.part, 0) / (s || 1);
}

/** Le volume d'impressions d'un jour, entier : budget ÷ jours ÷ CPM moyen. */
export function volumeJournalier(P: ParamsSimulation): number {
  return Math.round((P.budget / P.jours / cpmMoyen(P)) * 1000);
}

/** La densité d'un code postal, en habitants par km². `null` si incalculable. */
function densite(c: CpSimulation): number | null {
  if (!c.surface_km2 || c.surface_km2 <= 0 || c.pop_totale <= 0) return null;
  return c.pop_totale / c.surface_km2;
}

/**
 * La densité de référence : la médiane des codes postaux retenus.
 *
 * La médiane et non la moyenne : Paris et Lyon tirent la moyenne si haut que
 * tout le reste de la France paraîtrait rural.
 */
function densiteReference(cps: CpSimulation[]): number {
  const d = cps
    .filter((c) => c.retenu && !c.membre)
    .map(densite)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  if (d.length === 0) return 1;
  return d[Math.floor(d.length / 2)];
}

/**
 * La dérive lente de l'inventaire, par bassin, au jour donné.
 *
 * Une marche aléatoire multiplicative, rejouée depuis le jour 1 : c'est ce qui
 * rend un recalage imparfait. Recaler corrige l'écart OBSERVÉ ; l'inventaire,
 * lui, continue de bouger — exactement comme en vrai.
 */
export function deriveAuJour(zones: string[], P: ParamsSimulation, jour: number): Map<string, number> {
  const r = mulberry32((P.graine ^ hashStr('derive')) >>> 0);
  const tries = [...zones].sort();
  const d = new Map<string, number>(tries.map((z) => [z, 1]));
  const pas = P.derive / Math.sqrt(Math.max(1, P.jours));
  for (let j = 1; j <= jour; j++) {
    for (const z of tries) d.set(z, (d.get(z) ?? 1) * Math.exp(pas * gauss(r)));
  }
  return d;
}

/**
 * Répartit un entier au prorata de poids, sans perdre une unité.
 *
 * Méthode du plus fort reste : la somme rendue vaut EXACTEMENT `total`. Un
 * simple `Math.round` par élément perdrait ou créerait des impressions, et
 * « la somme des impressions vaut le volume » deviendrait faux à quelques
 * unités près — le genre d'écart qui fait douter de tout le reste.
 */
export function repartirEntier(total: number, poids: number[]): number[] {
  const s = poids.reduce((t, x) => t + x, 0);
  if (total <= 0 || s <= 0) return poids.map(() => 0);
  const bruts = poids.map((w) => (w / s) * total);
  const out = bruts.map(Math.floor);
  let reste = total - out.reduce((t, x) => t + x, 0);
  const ordre = bruts
    .map((b, i) => ({ i, f: b - Math.floor(b) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; reste > 0; k = (k + 1) % ordre.length, reste--) out[ordre[k].i]++;
  return out;
}

/**
 * Les parts des partenaires sur un code postal.
 *
 * Le moins cher penche vers le dense (inventaire abondant, enchères basses),
 * le plus cher vers le rare : c'est ce qui donne à chaque partenaire une part
 * en zone différente, au lieu de trois copies du même profil.
 */
function partsPartenaires(P: ParamsSimulation, ratioDensite: number): number[] {
  const n = P.partenaires.length;
  const lr = Math.log(Math.max(0.05, ratioDensite));
  const tries = P.partenaires.map((p, i) => ({ i, cpm: p.cpm })).sort((a, b) => a.cpm - b.cpm);
  const rang = new Map(tries.map((t, k) => [t.i, k]));
  const w = P.partenaires.map((p, i) => {
    const k = n > 1 ? 0.18 * (1 - (2 * (rang.get(i) ?? 0)) / (n - 1)) : 0;
    return p.part * Math.exp(k * lr);
  });
  const s = w.reduce((t, x) => t + x, 0);
  return w.map((x) => x / s);
}

/**
 * Le CPM payé sur un code postal : plus cher où l'inventaire est rare, et où
 * le plan pousse fort — deux raisons de surenchérir.
 */
function facteurCpm(ratioDensite: number, multiplicateur: number, multMoyen: number): number {
  const rare = Math.max(0, 1 - Math.min(1, ratioDensite));
  const lourd = Math.min(1, Math.max(0, multiplicateur / (multMoyen || 1) - 1));
  return 1 + 0.2 * rare + 0.1 * lourd;
}

/**
 * Diffuse UN jour sur un plan donné.
 *
 * @param cps - Les codes postaux de l'extraction.
 * @param plan - Le multiplicateur de chaque code postal pour ce jour (v1 ou v2).
 * @param P - Les paramètres.
 * @param jour - Le jour, à partir de 1.
 * @returns Une ligne par (code postal, partenaire) ayant reçu au moins une impression.
 */
export function diffuserJour(
  cps: CpSimulation[],
  plan: Map<string, number>,
  P: ParamsSimulation,
  jour: number,
): LigneDiffusion[] {
  const dRef = densiteReference(cps);
  const zones = [...new Set(cps.map((c) => c.cluster_id).filter((z): z is string => !!z))];
  const derive = deriveAuJour(zones, P, jour);
  const r = fluxDuJour(P.graine, jour, 'diffusion');

  const planifies = cps.filter((c) => (plan.get(c.code_postal) ?? 0) > 0);
  const multMoyen = planifies.reduce((t, c) => t + (plan.get(c.code_postal) ?? 0), 0)
    / Math.max(1, planifies.length);

  // Le poids de chaque code postal planifié, déformé par l'inventaire.
  const poids = planifies.map((c) => {
    const d = densite(c);
    const ratio = d == null ? 1 : d / dRef;
    const inv = Math.pow(ratio, P.intensite - 1);
    const dz = c.cluster_id ? (derive.get(c.cluster_id) ?? 1) : 1;
    const bruit = Math.exp(P.bruit * gauss(r) - (P.bruit * P.bruit) / 2);
    return (plan.get(c.code_postal) ?? 0) * inv * dz * bruit;
  });

  const volume = volumeJournalier(P);
  const fuites = cps.filter((c) => !c.retenu && !c.membre && c.pop_totale > 0);
  const volFuite = fuites.length > 0 ? Math.round(volume * P.fuite) : 0;

  const parCp = new Map<string, number>();
  repartirEntier(volume - volFuite, poids).forEach((v, i) => {
    parCp.set(planifies[i].code_postal, v);
  });
  // La fuite suit la population : on déborde là où il y a du monde.
  const poidsFuite = fuites.map((c) => c.pop_totale * Math.exp(0.3 * gauss(r) - 0.045));
  repartirEntier(volFuite, poidsFuite).forEach((v, i) => {
    const cp = fuites[i].code_postal;
    parCp.set(cp, (parCp.get(cp) ?? 0) + v);
  });

  const lignes: LigneDiffusion[] = [];
  const parCode = new Map(cps.map((c) => [c.code_postal, c]));
  for (const [cp, imps] of parCp) {
    if (imps <= 0) continue;
    const c = parCode.get(cp)!;
    const d = densite(c);
    const ratio = d == null ? 1 : d / dRef;
    const f = facteurCpm(ratio, plan.get(cp) ?? 0, multMoyen);
    const parts = repartirEntier(imps, partsPartenaires(P, ratio));
    parts.forEach((v, i) => {
      if (v <= 0) return;
      const p = P.partenaires[i];
      lignes.push({
        jour,
        code_postal: cp,
        partenaire: p.nom,
        impressions: v,
        // Arrondi au centime : la colonne est `numeric(12,4)`, et un coût au
        // dix-millième d'euro ne se lit nulle part.
        depense: Math.round((v / 1000) * p.cpm * f * 100) / 100,
      });
    });
  }
  return lignes;
}

/**
 * Diffuse une plage de jours sur un même plan.
 *
 * @returns Les lignes des jours `de` à `a` inclus.
 */
export function diffuserPeriode(
  cps: CpSimulation[],
  plan: Map<string, number>,
  P: ParamsSimulation,
  de: number,
  a: number,
): LigneDiffusion[] {
  const out: LigneDiffusion[] = [];
  for (let j = de; j <= a; j++) out.push(...diffuserJour(cps, plan, P, j));
  return out;
}

/** Le plan d'une extraction, tel que le générateur le consomme. */
export function planDeLExtraction(cps: CpSimulation[]): Map<string, number> {
  return new Map(cps.filter((c) => c.multiplicateur > 0).map((c) => [c.code_postal, c.multiplicateur]));
}
