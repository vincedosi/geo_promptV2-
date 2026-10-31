/**
 * @file lib/zones/plan-jeu-zone.ts — le plan CP d'un jeu de ZONE (lot 5, T8), la part PURE de l'extraction
 * (`extraction-jeu-zone.ts`), testée sans base.
 *
 * `genererPlanCp` — la fonction qui produit aussi le plan poussé au DSP — sur les CP de la couverture : classe `zone`
 * (poids 1, `poidsDeClasse`) pour un CP retenu, `hors` sinon, `mode_plan` du jeu, aucun poids réglé. Un code postal
 * indiscernable (`cp_groupe`) est acheté avec tout son groupe, le multiplicateur DIVISÉ par le nombre de membres
 * (`etendreAuxGroupes` ; piège 2 de `project_conversion_cp_phases`).
 *
 * ⚠ Duplication DÉCLARÉE : l'inverse des groupes (`canoniqueDe`) et la règle « populations sur le canonique, `null` sur
 * un membre » recopient le chemin risque de `app/api/zones/jeux/[id]/extractions/route.ts`, non factorisé pour ne pas
 * toucher au moteur risque (contrainte du lot 5).
 */
import { HORS_ZONE } from '@/lib/risques/affectation';
import type { LigneCouverture } from './couverture';
import { estRetenue } from './conversion';
import { genererPlanCp, type CpZone, type MembresParCanonique } from './plan';

/** La classe unique des codes postaux retenus d'un jeu de zone (`MOTIF_CLASSE`). */
const CLASSE_ZONE = 'zone';

/**
 * Le plan CP d'un jeu de zone. Sans `codesExacts` : retenu au seuil (`estRetenue`). Avec : la liste d'une recette
 * `codes_postaux` achetée au CP (maille EXACTE) — chaque code, ramené à son canonique, est retenu QUEL QUE SOIT le
 * seuil ; un canonique absent de la couverture (aucun carreau) entre au plan à population nulle plutôt que de
 * disparaître ; un CP de la couverture hors de la liste (carreaux en bordure) est `hors`.
 * Populations et part : celles du code CANONIQUE, `null` sur un membre de groupe (un 0 se lirait « personne »).
 */
export function planCpDeZone(
  lignes: readonly LigneCouverture[], seuil: number, mode_plan: 'pondere' | 'exclusif', groupes: MembresParCanonique,
  codesExacts?: readonly string[],
) {
  const canoniqueDe = new Map<string, string>();
  for (const [canonique, membres] of groupes) for (const m of membres) canoniqueDe.set(m, canonique);

  const liste = codesExacts ? new Set(codesExacts.map((c) => canoniqueDe.get(c) ?? c)) : null;
  const sources: LigneCouverture[] = [...lignes];
  for (const code of liste ?? []) {
    if (!lignes.some((l) => l.code === code)) {
      sources.push({ code, nom: null, commune: null, n_carreaux: 0, pop_en_zone: 0, pop_totale: null, part: null, part_brute: null });
    }
  }

  const cps: CpZone[] = sources.map((l) => {
    const retenu = liste ? liste.has(l.code) : estRetenue(l, seuil);
    return { code_postal: l.code, classe: retenu ? CLASSE_ZONE : HORS_ZONE, pop_en_zone: l.pop_en_zone, pop_totale: l.pop_totale ?? 0, retenu };
  });
  const plan = genererPlanCp(cps, { mode_plan, poids: {} }, groupes);
  const parCode = new Map(sources.map((l) => [l.code, l]));

  return {
    lignes: plan.lignes.map((l) => {
      const canonique = canoniqueDe.get(l.code_postal) ?? l.code_postal;
      const source = l.code_postal === canonique ? parCode.get(canonique) : undefined;
      return {
        code_postal: l.code_postal, code_canonique: canonique, classe: l.classe, retenu: l.retenu, multiplicateur: l.multiplicateur,
        pop_en_zone: source?.pop_en_zone ?? null, pop_totale: source?.pop_totale ?? null, part_en_zone: source?.part ?? null,
      };
    }),
    resume: {
      n_cp: cps.length,
      n_retenus: plan.n_retenus,
      taux_utile: plan.taux_utile,
      part_plan_en_zone: plan.part_plan_en_zone,
      population_exposee: cps.filter((c) => c.retenu).reduce((t, c) => t + c.pop_en_zone, 0),
    },
  };
}
