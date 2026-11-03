/**
 * @file lib/zones/plan-jeu-zone.ts — le plan CP d'un jeu de ZONE (lot 5, T8), la part PURE de l'extraction
 * (`extraction-jeu-zone.ts`), testée sans base.
 *
 * `genererPlanCp` en sémantique `'multiplicateur'` (A1, ARB-1, séquence E4) sur les UNITÉS CP de la couverture (A2 :
 * une ligne par groupe de codes postaux indiscernables, `lib/zones/unite-cp.ts`) : classe `zone` (poids 1,
 * `poidsDeClasse`) pour une unité retenue, `hors` sinon, aucun poids réglé. Une unité, une part, un multiplicateur :
 * part ÷ moyenne des parts retenues, écrêté à la plage du MÉCANISME de poids (`plateformes_poids`, sql/305), seules les
 * unités retenues au plan ; plus la ligne `HORS_ZONE` (E3). Le plan est ensuite DÉVELOPPÉ en autant de lignes que de
 * membres selon la règle du registre des mécanismes (`poids_groupe_cp` : `meme` répète le multiplicateur, `divise` le
 * partage puis le re-borne), et les écrêtages sont comptés en UNITÉS CP (une unité de compte pour tout le bilan).
 *
 * ⚠ Avant A2, ce plan passait les groupes à `genererPlanCp`, qui DIVISAIT le multiplicateur par le nombre de membres
 * (`etendreAuxGroupes`). Le chemin risque le fait toujours, inchangé (ruling A1 ↔ ⑥ du lot 1).
 *
 * B12 : UN PLAN PAR PLATEFORME au CP (`plansParPlateforme`), au seuil de cette plateforme et à la plage de SES
 * mécanismes, figé avec l'extraction (`zone_set_extraction_cp_plateforme`, sql/317). Le plan COMMUN (seuil le plus bas,
 * plage la plus ÉTROITE des mécanismes `multiplicateur`, règle de groupe unique — sinon refus nommé, `reglageDuPlan`)
 * est gardé tel quel dans `zone_set_extraction_cp` : c'est lui que lisent ⑥ Plan campagne, le rattachement, l'export et
 * la simulation (rétrocompatibilité, hors périmètre de B12). Ce que chaque plateforme reçoit est dit, par mécanisme, par
 * `sortiesPoids`, à partir de SON plan.
 * ⚠ D32 (sql/334) : le plan commun est DÉPRÉCIÉ (`PlansCp.commun`, `extraction-jeu-zone.ts`), retiré quand ⑥/⑦ liront
 * le plan par plateforme.
 *
 * ⚠ Duplication DÉCLARÉE : la règle « populations sur le canonique, `null` sur un membre » recopie le chemin risque de
 * `app/api/zones/jeux/[id]/extractions/route.ts`, non factorisé pour ne pas toucher au moteur risque (contrainte du
 * lot 5).
 */
import { HORS_ZONE } from '@/lib/risques/affectation';
import type { LigneCouverture } from './couverture';
import { estRetenue, type Avertissement } from './conversion';
import {
  MULT_MAX, MULT_MIN_NON_NUL, bornerMultiplicateur, genererPlanCp,
  type BilanMultiplicateur, type BornesMultiplicateur, type CpZone, type JournalBornes, type MembresParCanonique,
} from './plan';
import type { PlateformePoids } from './plateformes';
import { canoniques, developperUnites, membresDe, unitesDeGroupes } from './unite-cp';
import { REPARTITION_GROUPE, VOLUME_ATTENDU, partsPrevues, type UnitePrevue, type UniversVolume } from './part-prevue';

/** La classe unique des codes postaux retenus d'un jeu de zone (`MOTIF_CLASSE`). */
const CLASSE_ZONE = 'zone';

/** Ce que le registre des mécanismes impose au plan CP commun. */
export interface ReglagePlan {
  /** La plage du multiplicateur ; absente = bornes techniques de `numeric(6,3)`. */
  bornes?: BornesMultiplicateur;
  /** Ce que reçoit chaque membre d'un groupe ; absent = `meme`. */
  poids_groupe_cp?: 'meme' | 'divise';
  /** Une borne de la plage est « à vérifier » chez la plateforme qui la fixe (E9, par paramètre). */
  a_verifier?: { min: boolean; max: boolean };
}

/**
 * Les volumes attendus du référentiel (A8, E5 ; `volumes_attendus_cp_univers`, sql/337) : celui de chaque unité CP
 * demandée et le total des CP peuplés de l'UNIVERS de la zone (D35 : métropole ou France entière), d'où se déduit le
 * volume de `HORS_ZONE` (total de l'univers − unités retenues).
 */
export interface VolumesAttendus {
  par_code: ReadonlyMap<string, number>;
  total: number;
  /** L'univers du total (D35) ; absent = France entière, la lecture d'avant D35 (tests). */
  univers?: UniversVolume;
}

/** Le refus de `reglageDuPlan` : une phrase, prête pour un 422. */
type RefusReglage = { ok: false; message: string };

const LIBELLE_GROUPE = { meme: 'le même multiplicateur', divise: 'le multiplicateur divisé' } as const;

/**
 * Le réglage du plan CP commun, lu dans les mécanismes de poids des plateformes au CP (`plateformes_poids`) :
 * - la plage : la plus étroite des mécanismes `multiplicateur` (une valeur posée ne restreint que si elle est plus
 *   serrée) ; sans aucune plage connue, les bornes techniques ;
 * - la règle de groupe : celle de toutes les lignes, qui doit être UNIQUE (un seul plan) ;
 * - refus nommé si une plateforme au CP n'a aucune ligne au registre (on ne devine pas son mécanisme).
 */
export function reglageDuPlan(
  poids: readonly PlateformePoids[], plateformesAuCp: readonly string[],
): { ok: true; reglage: ReglagePlan } | RefusReglage {
  const sansLigne = plateformesAuCp.filter((p) => !poids.some((l) => l.plateforme === p && l.maille === 'cp'));
  if (sansLigne.length > 0) {
    return { ok: false, message: `${sansLigne.join(', ')} — aucun mécanisme de poids au CP dans le registre (plateformes_poids) : le plan ne peut pas être borné.` };
  }
  const lignes = poids.filter((l) => l.maille === 'cp' && plateformesAuCp.includes(l.plateforme));
  const regles = new Map<string, string[]>();
  for (const l of lignes) {
    const r = l.poids_groupe_cp ?? 'meme';
    regles.set(r, [...(regles.get(r) ?? []), `${l.plateforme} (${l.mecanisme})`]);
  }
  if (regles.size > 1) {
    const detail = [...regles].map(([r, qui]) => `${qui.join(', ')} : ${LIBELLE_GROUPE[r as 'meme' | 'divise']}`).join(' ; ');
    return {
      ok: false,
      message: `Règle d'un groupe de codes postaux divergente entre les plateformes au CP (${detail}) : le plan CP est commun à ces plateformes, choisissez-les dans deux jeux.`,
    };
  }
  let min = MULT_MIN_NON_NUL;
  let max = MULT_MAX;
  let minAVerifier = false;
  let maxAVerifier = false;
  for (const l of lignes) {
    if (l.mecanisme !== 'multiplicateur' || l.valeur_min === null || l.valeur_max === null) continue;
    if (l.valeur_min > min) { min = l.valeur_min; minAVerifier = l.parametres_a_verifier.includes('valeur_min'); }
    if (l.valeur_max < max) { max = l.valeur_max; maxAVerifier = l.parametres_a_verifier.includes('valeur_max'); }
  }
  return {
    ok: true,
    reglage: {
      bornes: { min, max },
      poids_groupe_cp: (regles.keys().next().value as 'meme' | 'divise' | undefined) ?? 'meme',
      a_verifier: { min: minAVerifier, max: maxAVerifier },
    },
  };
}

/**
 * Le plan CP d'un jeu de zone. Sans `codesExacts` : retenu au seuil (`estRetenue`). Avec : la liste d'une recette
 * `codes_postaux` achetée au CP (maille EXACTE) — chaque code, ramené à son unité, est retenu QUEL QUE SOIT le
 * seuil ; une unité absente de la couverture (aucun carreau) entre au plan à population nulle plutôt que de
 * disparaître (multiplicateur neutre, ARB-3) ; une unité de la couverture hors de la liste (carreaux en bordure) est
 * `hors`.
 * Populations et part : celles de l'unité, sur la ligne de son canonique, `null` sur les autres membres (un 0 se lirait
 * « personne »). `resume.n_cp` et `n_retenus` comptent des UNITÉS, `n_codes` les CODES envoyés (multiplicateur > 0) ;
 * les lignes rendues sont des codes. `resume.multiplicateur` : le bilan de la séquence E4 (moyennes avant / après
 * écrêtage, unités écrêtées, ajustements, tous comptés en UNITÉS CP, ligne `HORS_ZONE`).
 *
 * PART PRÉVUE (A8, E5, `part-prevue.ts`) : chaque code porte `part_prevue` — part × volume × classe ÷ Σ, sommée PAR
 * UNITÉ (HORS_ZONE comprise) puis répartie à parts égales entre les codes de l'unité ; `null` hors plan ou à volume
 * inconnu. Sans `volumes` (tests), le volume d'une unité est sa population totale de la cible — égal au volume V1
 * quand la cible est la population totale — et celui de `HORS_ZONE` est inconnu (une part prévue en mode national
 * devient alors `null` partout : on ne l'invente pas).
 */
export function planCpDeZone(
  lignes: readonly LigneCouverture[], seuil: number, mode_plan: 'pondere' | 'exclusif', groupes: MembresParCanonique,
  codesExacts?: readonly string[], reglage: ReglagePlan = {}, volumes?: VolumesAttendus,
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
    // A4 (ARB-3) : une unité à population inconnue (entière dans la zone) entre au plan à population nulle — multiplicateur
    // neutre, hors des moyennes —, comme une unité de liste exacte sans carreau ; les lignes rendues la gardent `null`.
    return { code_postal: l.code, classe: retenu ? CLASSE_ZONE : HORS_ZONE, pop_en_zone: l.pop_en_zone ?? 0, pop_totale: l.pop_totale ?? 0, retenu };
  });
  const bornes = reglage.bornes ?? { min: MULT_MIN_NON_NUL, max: MULT_MAX };
  const divise = reglage.poids_groupe_cp === 'divise';
  // Sans groupes : une ligne de plan par UNITÉ (son canonique), un multiplicateur (A2) ; sémantique multiplicateur (A1).
  const plan = genererPlanCp(cps, { mode_plan, poids: {} }, undefined, { semantique: 'multiplicateur', bornes });
  const parCode = new Map(sources.map((l) => [l.code, l]));

  // Ce que reçoit chaque CODE d'une unité : la règle de groupe du registre (`divise` partage), puis l'écrêtage — UNE fois
  // par unité, pour que le bilan compte en UNITÉS (voir `resume.multiplicateur`). Relecture A1, I-1.
  const journal: JournalBornes = new Map();
  const membresDeLigne = (u: { code_postal: string }) => membresDe(parCode.get(u.code_postal) ?? { code: u.code_postal }, groupes);
  const parCodeEnvoye = new Map<string, number>();
  const effectifs: number[] = [];
  for (const l of plan.lignes) {
    if (l.multiplicateur <= 0) continue;
    const n = divise ? membresDeLigne(l).length : 1;
    const v = bornerMultiplicateur((l.multiplicateur_calcule ?? l.multiplicateur) / n, bornes, journal);
    parCodeEnvoye.set(l.code_postal, v);
    // Le poids EFFECTIF de l'unité (Σ de ses codes en `divise`, celui de chaque code en `meme`), unités à part connue
    // seulement — la même population que la moyenne avant écrêtage.
    if ((parCode.get(l.code_postal)?.pop_totale ?? 0) > 0) effectifs.push(v * n);
  }
  const bilan = plan.multiplicateur as BilanMultiplicateur;

  // A8 : la part prévue, découplée du multiplicateur — unités retenues seulement (la classe unique `zone` pèse 1), plus
  // HORS_ZONE (volume = CP peuplés de l'univers de la zone − unités retenues, D35). Une unité retenue sans volume
  // connu : `null`, hors de la somme.
  const volumeDe = (c: CpZone): number | null => {
    const v = volumes ? volumes.par_code.get(c.code_postal) ?? null : c.pop_totale;
    return v !== null && v > 0 ? v : null;
  };
  const unitesPrevues: UnitePrevue[] = cps.filter((c) => c.retenu).map((c) => ({
    code: c.code_postal,
    membres: membresDeLigne(c),
    part: c.pop_totale > 0 ? c.pop_en_zone / c.pop_totale : null,
    volume: volumeDe(c),
    classe: 1,
  }));
  const volumeHorsZone = volumes
    ? Math.max(0, volumes.total - unitesPrevues.reduce((t, u) => t + (u.volume ?? 0), 0))
    : null;
  const prevues = partsPrevues(unitesPrevues, { part: 1, volume: volumeHorsZone, classe: bilan.hors_zone.classe });

  const developpe = developperUnites(plan.lignes, membresDeLigne, (u) => u.code_postal)
    .map(({ unite: l, code_postal, est_canonique }) => {
      const multiplicateur = parCodeEnvoye.get(l.code_postal) ?? 0;
      const source = est_canonique ? parCode.get(l.code_postal) : undefined;
      return {
        code_postal, code_canonique: l.code_postal, classe: l.classe, retenu: l.retenu, multiplicateur,
        pop_en_zone: source?.pop_en_zone ?? null, pop_totale: source?.pop_totale ?? null, part_en_zone: source?.part ?? null,
        part_prevue: l.retenu ? prevues.par_code.get(code_postal) ?? null : null,
      };
    });

  return {
    lignes: developpe,
    resume: {
      n_cp: cps.length,
      n_retenus: plan.n_retenus,
      n_codes: developpe.filter((l) => l.multiplicateur > 0).length,
      taux_utile: plan.taux_utile,
      part_plan_en_zone: plan.part_plan_en_zone,
      population_exposee: cps.filter((c) => c.retenu).reduce((t, c) => t + c.pop_en_zone, 0),
      // UNE unité de compte pour tout le bilan : l'UNITÉ CP (le groupe de codes indiscernables, A2). C'est sur elle que
      // la séquence E4 normalise (moyenne avant = 1 par construction) ; compter en codes ferait peser un groupe n fois
      // dans les moyennes. `n_ecretes` et `ajustements[].n` : unités écrêtées ; `moyenne_apres_ecretage` : moyenne des
      // poids effectifs des unités ; `ajustements[].valeur` : la valeur calculée PAR CODE la plus extrême (ce qui a été
      // ramené à la borne). Les CODES envoyés sont comptés à part, `resume.n_codes`.
      multiplicateur: {
        ...bilan,
        unite_de_compte: 'unite_cp' as const,
        poids_groupe_cp: reglage.poids_groupe_cp ?? 'meme',
        moyenne_apres_ecretage: effectifs.length > 0 ? Math.round((effectifs.reduce((t, x) => t + x, 0) / effectifs.length) * 1000) / 1000 : null,
        n_ecretes: [...journal.values()].reduce((t, a) => t + a.n, 0),
        ajustements: [...journal.values()],
        // D35 : l'univers du volume est figé avec lui (`resume_plan`, lu par `lireHorsZone`) ; `null` sans volumes.
        hors_zone: {
          ...bilan.hors_zone, volume: volumeHorsZone, univers: volumes ? volumes.univers ?? 'FR' : null, part_prevue: prevues.hors_zone,
        },
      },
      // A8 : comment la part prévue a été formée (figé dans `resume_plan`, sql/306). `unites_sans_part` : unités retenues
      // dont la part prévue est `null` (volume ou population inconnus) — dites, pas comptées à 0.
      part_prevue: {
        volume_attendu: VOLUME_ATTENDU,
        unite_de_somme: 'unite_cp' as const,
        repartition_groupe: REPARTITION_GROUPE,
        hors_zone: prevues.hors_zone,
        unites_sans_part: [...prevues.par_unite.values()].filter((p) => p === null).length,
      },
    },
  };
}

/** Le plan CP d'UNE plateforme (B12) : son seuil, le réglage de SES mécanismes, le plan qui en sort. */
export interface PlanPlateforme {
  plateforme: string;
  seuil: number;
  reglage: ReglagePlan;
  plan: ReturnType<typeof planCpDeZone>;
}

/**
 * B12 — un plan CP PAR plateforme au CP, au seuil de CETTE plateforme et borné par SES mécanismes (`reglageDuPlan` sur
 * elle seule) : une plateforme à 20 % ne reçoit plus les CP qu'une autre retient à 10 %, et sa normalisation (moyenne
 * des parts de SES retenus) ne dépend plus des choix des autres. Avec `codesExacts` (recette `codes_postaux`), la liste
 * fait le plan de chacune, seuil ignoré, comme pour le plan commun. Refus nommé si une plateforme n'a aucun mécanisme
 * au registre (on ne devine pas son mécanisme).
 */
export function plansParPlateforme(
  lignes: readonly LigneCouverture[], choix: readonly { plateforme: string; seuil: number }[], mode_plan: 'pondere' | 'exclusif',
  groupes: MembresParCanonique, poids: readonly PlateformePoids[], codesExacts?: readonly string[], volumes?: VolumesAttendus,
): { ok: true; plans: PlanPlateforme[] } | RefusReglage {
  const plans: PlanPlateforme[] = [];
  for (const c of choix) {
    const r = reglageDuPlan(poids, [c.plateforme]);
    if (!r.ok) return r;
    plans.push({
      plateforme: c.plateforme, seuil: c.seuil, reglage: r.reglage,
      plan: planCpDeZone(lignes, c.seuil, mode_plan, groupes, codesExacts, r.reglage, volumes),
    });
  }
  return { ok: true, plans };
}

/** Ce qu'une plateforme reçoit par UN de ses mécanismes de poids (figé dans le résumé de l'extraction). */
export interface SortiePoids {
  mecanisme: PlateformePoids['mecanisme'];
  branche: boolean;
  poids_groupe_cp: PlateformePoids['poids_groupe_cp'];
  /** Les paramètres non confirmés de ce mécanisme (E9), à afficher à côté de leur valeur. */
  parametres_a_verifier: PlateformePoids['parametres_a_verifier'];
  /** Les CODES envoyés à la plateforme (membres des groupes développés), pas les groupes. */
  n_codes: number;
  /** Mécanisme `multiplicateur` : la plage. */
  valeur_min?: number;
  valeur_max?: number;
  /** Une limite d'entrées par envoi : la limite et le nombre d'envois qu'il faut (découpage, ARB-6). */
  nb_max_entrees?: number;
  n_envois?: number;
}

/**
 * Les sorties de poids d'UNE plateforme au CP, une par mécanisme du registre, et les avertissements qui en découlent
 * (règle 5 : jamais silencieux) :
 * - les écrêtages du plan (`ajustements`, comptés en unités CP), dits SEULEMENT chez une plateforme dont un mécanisme
 *   `multiplicateur` porte la borne franchie, avec « à vérifier » si CE mécanisme ne l'a pas confirmée. Une plateforme
 *   sans multiplicateur (budget_ligne, aucun) ne reçoit aucun multiplicateur : elle ne dit rien d'un écrêtage
 *   (relecture A1, I-2 — elle annonçait « ×10, le maximum admis par la plateforme », borne de DV360) ;
 * - `nb_max_entrees` : au-delà, le plan part en `ceil(n_codes ÷ limite)` envois (découpage trié par part, ARB-6),
 *   compté en CODES (relecture de A2 : 981 codes pour 895 groupes sur la zone composite).
 */
export function sortiesPoids(
  poids: readonly PlateformePoids[], plateforme: string, n_codes: number,
  plan: { ajustements: readonly { code: 'multiplicateur_min' | 'multiplicateur_max'; limite: number; valeur: number; n: number }[] },
): { sorties: SortiePoids[]; avertissements: Avertissement[] } {
  const lignes = poids.filter((l) => l.plateforme === plateforme && l.maille === 'cp');
  const avertissements: Avertissement[] = [];
  for (const a of plan.ajustements) {
    const min = a.code === 'multiplicateur_min';
    // Le mécanisme multiplicateur de CETTE plateforme dont la borne est celle franchie.
    const m = lignes.find((l) => l.mecanisme === 'multiplicateur' && (min ? l.valeur_min : l.valeur_max) === a.limite);
    if (!m) continue;
    avertissements.push({ ...a, ...(m.parametres_a_verifier.includes(min ? 'valeur_min' : 'valeur_max') ? { a_verifier: true as const } : {}) });
  }
  const sorties = lignes.map((l): SortiePoids => {
    const s: SortiePoids = {
      mecanisme: l.mecanisme, branche: l.branche, poids_groupe_cp: l.poids_groupe_cp,
      parametres_a_verifier: l.parametres_a_verifier, n_codes,
    };
    if (l.valeur_min !== null && l.valeur_max !== null) Object.assign(s, { valeur_min: l.valeur_min, valeur_max: l.valeur_max });
    if (l.nb_max_entrees !== null) {
      const n_envois = Math.max(1, Math.ceil(n_codes / l.nb_max_entrees));
      Object.assign(s, { nb_max_entrees: l.nb_max_entrees, n_envois });
      if (n_codes > l.nb_max_entrees) {
        avertissements.push({
          code: 'nb_max_entrees', limite: l.nb_max_entrees, valeur: n_codes, n: n_envois, mecanisme: l.mecanisme,
          ...(l.parametres_a_verifier.includes('nb_max_entrees') ? { a_verifier: true as const } : {}),
        });
      }
    }
    return s;
  });
  return { sorties, avertissements };
}
