/**
 * ⑥ Plan — le LANCEMENT d'une campagne (lot 6, T6 ; arbitrages A-9, A-10, E2 ; spec § 19) : la règle de validité, la
 * demande, la séquence d'appels et le message final. Le port du chemin « jeu de zones » de `StepLancement.tsx`
 * (`handleArm`, `:209-302`), UN SEUL chemin (A-9) :
 *
 *   PATCH identité (si changée) → `rattacher({ campagne, extraction })` → PATCH stratégie (E2) → PUT canaux
 *
 * SÉQUENTIEL (une requête à la fois) ; le premier échec ARRÊTE la suite : un `rattacher` refusé n'écrit ni budget ni
 * canaux. E2 (défaut React corrigé) : après `rattacher`, la stratégie reçoit `total_budget`, `forecast_cpm` (CPM moyen
 * pondéré), `start_date`, `end_date` et `kpi_target` = Σ impressions prévues — EXACTEMENT les `totaux` affichés par la
 * section Impressions (`PlanCampagneService.totaux`, une seule source). React ne les écrivait pas : le rythme de ⑧ et
 * `get_campaign_expected` lisaient une stratégie vide. Relancer une campagne déjà rattachée suit le même chemin :
 * `rattacher` archive l'ancienne stratégie.
 *
 * Écarts à React, listés : le PATCH d'identité ARRÊTE le lancement s'il échoue (React le passait sous silence — rien
 * n'est encore écrit à ce moment, autant le dire) ; le PUT des canaux aussi (React l'ignorait : le plan serait écrit
 * sans budgets ni liaisons, et ⑦/⑧ liraient des canaux périmés). La « deuxième validation » des liaisons de
 * `StepLancement` n'est pas reprise : la coche de la section Plateformes est la seule (une étape, plus de wizard).
 */
import { type Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';
import { messageErreurApi } from '../../../core/http/erreurs';
import type { Campagne, CorpsCampagne, CorpsCanaux, CorpsStrategie, PlanApi, PlanRattache } from '../data/plan.api';
import type { ProgDraft } from '../logique/plan/brouillon';
import { pruneBudgets } from '../logique/plan/canaux';
import type { PrevisionPlateforme, TotauxPrevus } from '../logique/plan/impressions';

/** Le plus grand volume que `bidding_strategies.kpi_target` (`numeric(14,4)`) sait porter (relecture 3, M1). */
export const IMPRESSIONS_MAX = 9_999_999_999;

/** Ce qui part au serveur, dans l'ordre. */
export interface DemandeLancement {
  campagne: string;
  /** Les seuls champs d'identité qui ont changé ; `null` : pas de PATCH. */
  identite: CorpsCampagne | null;
  jeu: string;
  extraction: string;
  strategie: CorpsStrategie;
  canaux: CorpsCanaux;
}

/** Ce que le pied lit : une demande prête, ou les motifs qui la bloquent (dans l'ordre de l'écran). */
export type EtatLancement = { demande: DemandeLancement; motifs: [] } | { demande: null; motifs: string[] };

export interface EntreesLancement {
  campagne: string | null;
  detail: Campagne | null;
  brouillon: ProgDraft;
  previsions: readonly PrevisionPlateforme[];
  totaux: TotauxPrevus;
  liaisonsConfirmees: boolean;
  /** Le libellé d'un code de canal (catalogue de la campagne). */
  libelle: (code: string) => string;
}

/**
 * La règle de validité de React (`invalid`, `StepLancement.tsx:209-211`) restreinte au chemin extraction (A-9) et
 * complétée des CPM prévus (A-10) : extraction choisie, nom, au moins une plateforme, budget ET CPM prévu pour chacune,
 * période complète et ordonnée, liaisons confirmées.
 */
export function etatLancement(e: EntreesLancement): EtatLancement {
  const d = e.brouillon;
  const nom = d.name.trim() || e.detail?.name || '';
  const extraction = d.jeuZones?.extraction;
  const sansBudget = e.previsions.filter((p) => !(p.budget && p.budget > 0)).map((p) => e.libelle(p.code));
  const motifs = [
    !extraction ? 'Choisis une extraction en section Cible.' : '',
    !nom ? 'Nom de la campagne manquant.' : '',
    e.previsions.length === 0 ? 'Choisis au moins un DSP ou un réseau.' : '',
    sansBudget.length ? `Budget manquant : ${sansBudget.join(', ')}` : '',
    e.totaux.cpmManquants.length ? `CPM prévu manquant : ${e.totaux.cpmManquants.map(e.libelle).join(', ')}` : '',
    (e.totaux.impressions ?? 0) > IMPRESSIONS_MAX ? 'Plus de 9 999 999 999 impressions prévues : vérifie budgets et CPM.' : '',
    !d.startDate || !d.endDate ? 'Période incomplète.' : d.endDate < d.startDate ? 'La fin de la période précède son début.' : '',
    e.previsions.length > 0 && !e.liaisonsConfirmees ? 'Confirme les liaisons en section Plateformes et budget.' : '',
  ].filter(Boolean);
  if (motifs.length || !e.campagne || !e.detail || !d.jeuZones || !extraction) {
    return { demande: null, motifs: motifs.length ? motifs : ['Chargement de la campagne…'] };
  }
  return {
    motifs: [],
    demande: {
      campagne: e.campagne,
      identite: identiteChangee(d, e.detail, nom),
      jeu: d.jeuZones.id,
      extraction: extraction.id,
      strategie: {
        total_budget: e.totaux.budget,
        forecast_cpm: e.totaux.cpmMoyen,
        start_date: d.startDate,
        end_date: d.endDate,
        kpi_target: e.totaux.impressions,
      },
      canaux: {
        ...d.channels,
        budgets: pruneBudgets(d.channelBudgets, d.channels),
        cpm_prevus: pruneBudgets(d.cpmPrevus, d.channels),
        links: d.channelLinks,
      },
    },
  };
}

/** Nom, annonceur et produit qui diffèrent de la campagne lue (`StepLancement.tsx:218-222`) ; `null` si aucun. */
function identiteChangee(d: ProgDraft, c: Campagne, nom: string): CorpsCampagne | null {
  const corps: CorpsCampagne = {};
  if (nom !== c.name) corps.name = nom;
  if (d.advertiser.trim() !== (c.advertiser ?? '')) corps.advertiser = d.advertiser.trim();
  if (d.product.trim() !== (c.product ?? '')) corps.product = d.product.trim();
  return Object.keys(corps).length ? corps : null;
}

/** Un échec nommé par son étape : le titre de la notification, et le message de la route. */
export class EchecLancement extends Error {
  constructor(readonly titre: string, message: string) {
    super(message);
  }
}

/** L'étape échouée, nommée ; le message reste celui de la route (`messageErreurApi`). */
const etape = <T>(titre: string, source: Observable<T>) =>
  source.pipe(catchError((e: unknown) => throwError(() => new EchecLancement(titre, messageErreurApi(e)))));

/** La séquence, une requête à la fois ; le premier échec arrête tout. Rend la réponse de `rattacher`. */
export function lancerCampagne(api: PlanApi, d: DemandeLancement): Observable<PlanRattache> {
  const avant: Observable<unknown> = d.identite ? etape('Renommage impossible', api.modifierCampagne(d.campagne, d.identite)) : of(null);
  return avant.pipe(
    switchMap(() => etape('Rattachement impossible', api.rattacher(d.jeu, { campagne: d.campagne, extraction: d.extraction }))),
    switchMap((r) => etape('Budget et période non enregistrés', api.modifierStrategie(r.strategie, d.strategie)).pipe(map(() => r))),
    switchMap((r) => etape('Plateformes non enregistrées', api.ecrireCanaux(d.campagne, d.canaux)).pipe(map(() => r))),
  );
}

/**
 * « N codes postaux · X % du plan en zone · Y % d'utile · Z impressions prévues » — les deux chiffres qui voyagent avec
 * le plan (React), plus le volume prévu. Sans plateforme au CP (0 CP, T6), le message le dit au lieu d'un « 0 ».
 */
export function messageLancement(r: PlanRattache, impressions: number | null): string {
  const prevues = impressions == null ? null : `${formaterNombre(impressions)} impressions prévues`;
  if (r.codes_postaux === 0) {
    return ['Aucune plateforme n’achète au code postal : plan sans répartition par CP', prevues].filter(Boolean).join(' · ');
  }
  return [
    `${formaterNombre(r.codes_postaux)} codes postaux`,
    typeof r.part_plan_en_zone === 'number' ? `${formaterDecimal(r.part_plan_en_zone, 0)} % du plan en zone` : null,
    typeof r.taux_utile === 'number' ? `${formaterDecimal(r.taux_utile, 1)} % d’utile` : null,
    prevues,
  ].filter(Boolean).join(' · ');
}
