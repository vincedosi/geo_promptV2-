/**
 * @file lib/zones/plan-jeu-zone.ts — le plan CP d'un jeu de ZONE (lot 5, T8), la part PURE de l'extraction
 * (`extraction-jeu-zone.ts`), testée sans base.
 *
 * `genererPlanCp` — la fonction qui produit aussi le plan poussé au DSP — sur les UNITÉS CP de la couverture (A2 : une
 * ligne par groupe de codes postaux indiscernables, `lib/zones/unite-cp.ts`) : classe `zone` (poids 1, `poidsDeClasse`)
 * pour une unité retenue, `hors` sinon, `mode_plan` du jeu, aucun poids réglé. Une unité, une part, un multiplicateur ;
 * le plan est ensuite DÉVELOPPÉ en autant de lignes que de membres, au MÊME multiplicateur (`developperUnites`). La
 * question « même ou divisé » est un paramètre du registre, « à vérifier » (`plateformes_geo.poids_groupe_cp`).
 *
 * ⚠ Avant A2, ce plan passait les groupes à `genererPlanCp`, qui DIVISAIT le multiplicateur par le nombre de membres
 * (`etendreAuxGroupes`). Le chemin risque le fait toujours, inchangé (ruling A1 ↔ ⑥ du lot 1).
 *
 * ⚠ Duplication DÉCLARÉE : la règle « populations sur le canonique, `null` sur un membre » recopie le chemin risque de
 * `app/api/zones/jeux/[id]/extractions/route.ts`, non factorisé pour ne pas toucher au moteur risque (contrainte du
 * lot 5).
 */
import { HORS_ZONE } from '@/lib/risques/affectation';
import type { LigneCouverture } from './couverture';
import { estRetenue } from './conversion';
import { genererPlanCp, type CpZone, type MembresParCanonique } from './plan';
import { canoniques, developperUnites, membresDe, unitesDeGroupes } from './unite-cp';

/** La classe unique des codes postaux retenus d'un jeu de zone (`MOTIF_CLASSE`). */
const CLASSE_ZONE = 'zone';

/**
 * Le plan CP d'un jeu de zone. Sans `codesExacts` : retenu au seuil (`estRetenue`). Avec : la liste d'une recette
 * `codes_postaux` achetée au CP (maille EXACTE) — chaque code, ramené à son unité, est retenu QUEL QUE SOIT le
 * seuil ; une unité absente de la couverture (aucun carreau) entre au plan à population nulle plutôt que de
 * disparaître ; une unité de la couverture hors de la liste (carreaux en bordure) est `hors`.
 * Populations et part : celles de l'unité, sur la ligne de son canonique, `null` sur les autres membres (un 0 se lirait
 * « personne »). `resume.n_cp` et `n_retenus` comptent des UNITÉS ; les lignes rendues sont des codes.
 */
export function planCpDeZone(
  lignes: readonly LigneCouverture[], seuil: number, mode_plan: 'pondere' | 'exclusif', groupes: MembresParCanonique,
  codesExacts?: readonly string[],
) {
  // Code → unité : les membres que la couverture déclare (sql/304), complétés par `cp_groupe` pour les codes d'une
  // liste exacte que la couverture ne touche pas.
  const canoniqueDe = canoniques([
    ...unitesDeGroupes(groupes),
    ...lignes.map((l) => ({ code: l.code, membres: membresDe(l, groupes) })),
  ]);

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
  // Sans groupes : une ligne de plan par UNITÉ (son canonique), un multiplicateur.
  const plan = genererPlanCp(cps, { mode_plan, poids: {} });
  const parCode = new Map(sources.map((l) => [l.code, l]));

  return {
    lignes: developperUnites(plan.lignes, (u) => membresDe(parCode.get(u.code_postal) ?? { code: u.code_postal }, groupes), (u) => u.code_postal)
      .map(({ unite: l, code_postal, est_canonique }) => {
        const source = est_canonique ? parCode.get(l.code_postal) : undefined;
        return {
          code_postal, code_canonique: l.code_postal, classe: l.classe, retenu: l.retenu, multiplicateur: l.multiplicateur,
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
