import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { ClustersService } from '../../couches/clusters.service';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import { CouvertureRayonService } from '../../etat/couverture-rayon.service';
import { ScoreCompositeService } from '../../etat/score-composite.service';
import { FOURNIR_TIROIRS_ANALYSE } from '../../etat/tiroirs-analyse';
import { TypologiesZoneService } from '../../etat/typologies-zone.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import type { FiltreActif } from '../../logique/filtre';
import { messageRefusTerritoireBataille } from '../../logique/bataille/parametres';
import { type OutilAnalyse, messageGardePerimetre } from '../../logique/garde-perimetre';
import { messageGardeCarte } from '../../logique/perimetre-national';
import { ISO_MODES } from '../../logique/modes-isochrones';
import type { CorpsLancementClustering } from '../../logique/clustering/assistant';
import { CalculClusteringService } from './clustering/calcul-clustering.service';
import { SectionClusteringComponent } from './clustering/section-clustering.component';
import { IntroAnalyseComponent } from './intro-analyse.component';
import { OutilBatailleV2Component } from './outil-bataille-v2.component';
import { OutilCorrelationComponent } from './outil-correlation.component';
import { OutilCouvertureComponent } from './outil-couverture.component';
import { OutilRayonComponent } from './outil-rayon.component';
import { OutilScoreComponent } from './outil-score.component';
import { TypologiesZoneComponent } from './typologies-zone.component';
import { ENTETE_ACCORDEON, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/**
 * Le panneau « Analyse » de la carte — portage de `app/map/_components/panneaux/PanneauAnalyse.tsx` (lot 4, T17) :
 * le message de garde, puis l'accordéon « Analyse spatiale » (encarts d'accueil, mode de transport, Bataille V2), puis les accordéons « Score composite » et « Corrélation » (T18), puis « Clustering » (T19,
 * super admin seulement — `clusteringOuvert`, `PanneauAnalyse.tsx:162`, dans l'ordre de React).
 *
 * ── GARDE DE PÉRIMÈTRE (spec §5, incidents du 28/03 et du 08/04) ─────────
 * Chaque lancement passe par `verifierPerimetreOutil('<outil>')` AVANT d'appeler son service : sans filtre, « Choisissez
 * un périmètre… » ; sur la France entière, un refus qui NOMME l'outil — et aucune requête dans les deux cas. Les outils
 * ÉMETTENT, ce panneau garde : verrou structurel `tests/unit/angular/panneau-analyse-garde.test.ts`, qui lit CE source.
 * Le message vit au niveau du panneau (un refus de n'importe quel outil s'y affiche) et s'efface dès qu'un filtre est
 * posé. La RELECTURE d'un modèle de clustering (`chargerClusters`) passe par la garde GÉNÉRIQUE `verifierPerimetre`,
 * sans refus national : ce n'est pas le calcul lourd (`handleLoadClustersGarde`, `PanneauAnalyse.tsx:278`). Le calcul
 * lourd — le `POST /api/poi-clusters/run` de l'assistant (T20) — passe par `verifierPerimetreOutil('clustering')`
 * (`lancerClustering`), qui REFUSE la France entière ; son job (`CalculClusteringService`) est fourni ici, et le message
 * de garde redescend jusqu'à l'assistant (`[refusCalcul]`), qui l'affiche à l'endroit du clic.
 *
 * ── VORONOÏ ABSENT ───────────────────────────────────────────────────────
 * Décision du propriétaire : le Voronoï ne se lançait que par un message à l'Assistant, jamais porté. Il n'est ni
 * rendu ni gardé ici (React l'affichait entre le mode de transport et la Bataille V2).
 *
 * ── SCORE COMPOSITE ET CORRÉLATION (T18) ─────────────────────────────────
 * Le score est le SEUL outil qui admet la France entière (`messageGardeOutil('score_composite', …)`, 159 ms mesurés) :
 * il passe par la même garde, qui ne refuse chez lui que l'absence de filtre. La corrélation n'est PAS gardée,
 * délibérément : bornée par une campagne, elle ne balaie aucun territoire. Leur état (réglages, catalogue partagé) est
 * fourni ICI : fermer le panneau les perd, comme React ; le score peint reste sur la carte (`ScoreService`, page).
 *
 * ── BATAILLE V1 RETIRÉE (décision de Vincent, 27/10) ─────────────────────
 * L'outil « Isochrones routiers (ORS) », son application `ST_Difference` et `BatailleV1Service` sont partis : la V2
 * couvre le besoin, et son remplissage ORS du cache (`remplirV2`) reste. La route protégée `/api/isochrone-battle` n'est
 * plus appelée par Angular QUE pour ce remplissage ; React garde sa V1 jusqu'à son retrait.
 *
 * Le territoire de la bataille vient du FILTRE (`ContexteBatailleService`), pas du sélecteur de périmètre, code mort
 * côté React depuis la refonte du panneau Filtre — sauf « Sur : la zone analysée » (④ finitions, T7) : la zone est alors
 * le périmètre, la garde de ① ne s'applique pas et la ligne A-9 ne s'affiche plus pour la bataille. Un filtre code postal ou zone passe la garde mais n'est PAS transmis
 * à la bataille : React la lançait alors sur toute la métropole. Ici, elle est REFUSÉE avec un message
 * (`messageRefusTerritoireBataille`) — défaut React corrigé, revue finale du lot 4 (registre, ligne 71).
 *
 * ── LA MÉTROPOLE (retours du 26/10, T4) ──────────────────────────────────
 * La garde est `messageGardeCarte` : `messageGardeOutil` à l'identique, sauf sur `FILTRE_METROPOLE`, où la bataille V2 et
 * le score passent et où Voronoï et clustering refusent en nommant la métropole. Une bataille admise peut encore être
 * refusée par la capacité en direct (`ContexteBatailleService.refusBorne`, compté au clic) : ce refus s'affiche au même
 * endroit que la garde (`messageAffiche`), et part lui aussi quand le filtre change.
 *
 * ── TIROIRS EXCLUSIFS (retours du 26/10, T7) ─────────────────────────────
 * Couverture, rayon, score, corrélation et clustering sont UN jeu de tiroirs (`TIROIRS_ANALYSE`, fourni ici) : en ouvrir
 * un referme l'autre, la couverture est ouverte à l'ouverture. « Analyse spatiale » est un en-tête de groupe, hors du jeu
 * (A-11) ; dedans, la Bataille V2 a son propre repli (`batailleOuverte`). Replier ne relit rien : voir chaque outil.
 */
@Component({
  selector: 'mg-panneau-analyse',
  imports: [
    IntroAnalyseComponent, NgTemplateOutlet, OutilBatailleV2Component, OutilCorrelationComponent, OutilCouvertureComponent, OutilRayonComponent,
    OutilScoreComponent, SectionClusteringComponent, TypologiesZoneComponent,
  ],
  // Le catalogue d'indicateurs (score, corrélation) vient de la PAGE (lot 3, X4), partagé avec ③ et « Mes zones ».
  // La couverture par rayon (T12) aussi : le panneau reste monté (P-e), sa couche se retire avec lui.
  // Les tiroirs exclusifs de ④ (T7) : partagés par les outils et par les deux services ci-dessus, qui en dérivent `ouvert`.
  providers: [FOURNIR_TIROIRS_ANALYSE, ScoreCompositeService, CouvertureRayonService, CreationZoneService, CalculClusteringService, TypologiesZoneService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    @if (messageAffiche(); as m) {
      <div data-garde role="alert"
        class="mx-[14px] mt-[10px] rounded-[4px] border-fin border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[10px] py-2 text-[12px] leading-[1.5] text-danger">
        ! {{ m }}
      </div>
    }

    <!-- Lot 4, T8 : la couverture d'une zone EN TÊTE, ouverte par défaut. Hors garde de ① : la zone est le périmètre. -->
    <mg-outil-couverture />
    <!-- Lot 4, T12 : hors garde de ① elle aussi — la base borne le périmètre (France, région, > 12 000 km² refusés). -->
    <mg-outil-rayon />

    <div class="flex flex-col">
      <button type="button" data-accordeon="spatiale" [attr.aria-expanded]="spatialeOuverte()" (click)="spatialeOuverte.set(!spatialeOuverte())"
        [class]="entete">
        <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
        <span class="flex-1 text-left text-[12px] font-medium text-primary">Analyse spatiale</span>
        <span class="text-[10px] text-tertiary">{{ spatialeOuverte() ? '▲' : '▼' }}</span>
      </button>
      @if (spatialeOuverte()) {
        <div class="border-b-fin border-subtle p-4">
          @if (zoneAnalysee() && !v2.zoneBataille()) { <ng-container *ngTemplateOutlet="lignePerimetre1" /> }
          <div class="pb-1">
            <mg-intro-analyse [nombrePoi]="nombrePoi()" />
            @if (contexte.unPoi()) {
              <div class="mt-1 flex flex-col gap-2">
                <div>
                  <div class="mb-1.5 text-[11px] font-medium text-secondary">Mode de transport</div>
                  <div class="flex gap-[5px]">
                    @for (m of modes; track m.id) {
                      <button type="button" [attr.data-mode]="m.id" [attr.aria-pressed]="contexte.mode() === m.id" (click)="contexte.mode.set(m.id)"
                        [class]="pastille + ' flex-1 text-center ' + (contexte.mode() === m.id ? pastillePrimaire : pastilleInactive)">{{ m.label }}</button>
                    }
                  </div>
                </div>
                <mg-outil-bataille-v2
                  [ouvert]="batailleOuverte()"
                  (basculer)="batailleOuverte.set(!batailleOuverte())"
                  (verifierCache)="verifierCacheV2()"
                  (remplir)="remplirV2()"
                  (lancer)="lancerV2($event)"
                />
              </div>
            }
          </div>
        </div>
      }
    </div>

    <!-- PanneauAnalyse.tsx:430-475 : le score composite (gardé, France admise), la corrélation (non gardée), le clustering. -->
    <mg-outil-score (lancer)="lancerScore()" />
    <mg-outil-correlation />
    <!-- ④ finitions (T8) : les typologies déjà calculées des POI de la zone, pour TOUS ; le calcul reste au super admin. -->
    <mg-typologies-zone />
    <!-- Preuve T9, D-6 : sous les typologies, « Cet outil » ne disait pas lequel — la ligne nomme le clustering. -->
    @if (clusteringOuvert() && zoneAnalysee()) {
      <div data-perimetre-clustering class="mx-[14px] mt-[10px]"><ng-container *ngTemplateOutlet="lignePerimetre1; context: { $implicit: 'Le clustering' }" /></div>
    }
    <!-- A-9 : la ligne des outils qui ne lisent pas la zone analysée, écrite une fois ; le sujet par défaut est « Cet outil ». -->
    <ng-template #lignePerimetre1 let-sujet><div data-perimetre-etape-1 class="mb-2 text-[11px] leading-[1.5] text-tertiary">{{ sujet ?? 'Cet outil' }} travaille sur le périmètre de l’étape ①.</div></ng-template>
    @if (clusteringOuvert()) { <mg-section-clustering [refusCalcul]="gardeMessage()" (charger)="chargerClusters()" (lancerCalcul)="lancerClustering($event)" /> }
  `,
})
export class PanneauAnalyseComponent {
  private readonly etat = inject(EtatCarteService);
  protected readonly contexte = inject(ContexteBatailleService);
  protected readonly v2 = inject(BatailleV2Service);
  private readonly clusters = inject(ClustersService);
  private readonly calculClustering = inject(CalculClusteringService);

  private readonly scoreComposite = inject(ScoreCompositeService);
  /**
   * A-9 (lot 4) : quand une zone est analysée, les batailles et le clustering — qui ne savent pas la prendre — disent
   * en une ligne sur quoi ils travaillent.
   */
  private readonly analysee = inject(ZoneAnalyseeService);
  protected readonly zoneAnalysee = computed(() => this.analysee.zoneId() !== null);

  protected readonly modes = ISO_MODES;
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly pastille = PASTILLE;
  protected readonly pastillePrimaire = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  /** Fermé à l'ouverture du panneau, comme React (`analyseOpen.spatiale: false`). */
  protected readonly spatialeOuverte = signal(false);
  /** La Bataille V2, repliée à l'ouverture (seul outil de l'accordéon depuis le retrait de la V1). */
  protected readonly batailleOuverte = signal(false);
  protected readonly nombrePoi = computed(() => this.etat.poiSelectionnes().length);
  /** L'outil du dernier refus : seule la zone analysée du SCORE efface son refus (T10 R-1 — la bataille ne la lit pas). */
  private readonly outilRefuse = signal<OutilAnalyse | null>(null);
  /** Le dernier refus ; un filtre posé l'efface (`useEffect(() => { if (filtre) setGardeMessage(null) })`). */
  protected readonly gardeMessage = linkedSignal<FiltreActif | string | null, string | null>({
    // Une zone analysée est un périmètre suffisant pour le score (T10) et la bataille « Sur : la zone » (④ finitions, T7) :
    // la choisir efface LEUR refus, pas celui des autres.
    source: computed(() => this.etat.filtre() ?? this.zoneDeLOutil(this.outilRefuse())),
    computation: (perimetre, precedent) => (perimetre ? null : (precedent?.value ?? null)),
  });

  /** Ce que le bandeau affiche : la garde, sinon le refus de capacité d'une bataille sur la métropole. */
  protected readonly messageAffiche = computed(() => this.gardeMessage() ?? this.contexte.refusBorne());

  private readonly auth = inject(AuthService);
  /** Le rôle de la session COURANTE, relu à chaque changement de compte (`session?.user.role` de React). */
  private readonly role = signal<string | null>(null);
  /** Le clustering est réservé au super admin (`clusteringOuvert = session?.user.role === 'super_admin'`). */
  protected readonly clusteringOuvert = computed(() => this.role() === 'super_admin');

  constructor() {
    // Une lecture par identifiant de session (`lireProfil` est mémoïsé) ; une réponse d'un compte quitté est ignorée.
    effect(() => {
      const id = this.auth.session()?.user?.id ?? null;
      untracked(() => {
        this.role.set(null);
        if (!id) return;
        void this.auth.lireProfil().then((p) => {
          if ((this.auth.session()?.user?.id ?? null) === id) this.role.set(p?.role ?? null);
        });
      });
    });
    // Le nom des régions dans le journal et la règle « toutes les régions » : lu une fois par écran (cache).
    inject(ReferentielGeoService).charger();
  }

  /**
   * La garde, pour UN outil : le message affiché, `true` si le calcul peut partir (`messageGardeCarte`). La bataille
   * refuse EN PLUS un filtre qu'elle ne sait pas transmettre (code postal, zone) : sans lui, elle partirait sur toute la
   * métropole (`messageRefusTerritoireBataille`, défaut React corrigé).
   */
  protected verifierPerimetreOutil(outil: OutilAnalyse): boolean {
    const bataille = outil === 'bataille_v2';
    // Le score (lot 4, T10) et la bataille « Sur : la zone » (④ finitions, T7) lisent la zone : elle tient lieu de
    // périmètre. La bataille sur une zone ne regarde pas ① (France comprise) : la route borne la zone (404, 422, 700 anneaux).
    const zone = this.zoneDeLOutil(outil);
    const message = bataille && zone ? null : messageGardeCarte(outil, this.etat.filtre(), zone)
      ?? (bataille ? messageRefusTerritoireBataille(this.etat.filtre()) : null);
    this.outilRefuse.set(outil);
    this.gardeMessage.set(message);
    return message === null;
  }

  /** La zone analysée qu'un outil LIT, ou `null` : le score et la bataille V2 (selon leur bascule « Sur »). */
  private zoneDeLOutil(outil: OutilAnalyse | null): string | null {
    if (outil === 'score_composite') return this.scoreComposite.zoneScore();
    return outil === 'bataille_v2' ? this.v2.zoneBataille() : null;
  }

  /** La garde GÉNÉRIQUE (`verifierPerimetre` de React) : un périmètre, n'importe lequel — la France entière comprise. */
  protected verifierPerimetre(): boolean {
    const message = messageGardePerimetre(this.etat.filtre());
    this.outilRefuse.set(null);
    this.gardeMessage.set(message);
    return message === null;
  }

  /** « Charger les clusters » : relire un modèle déjà calculé, une fois un périmètre choisi. */
  protected chargerClusters(): void {
    if (!this.verifierPerimetre()) return;
    this.clusters.charger();
  }

  /** « Lancer » de l'assistant de clustering : le calcul LOURD — refusé sans filtre et sur la France entière. */
  protected lancerClustering(corps: CorpsLancementClustering): void {
    if (!this.verifierPerimetreOutil('clustering')) return;
    this.calculClustering.lancer(corps);
  }

  protected verifierCacheV2(): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.verifierCache();
  }

  protected remplirV2(): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.remplir();
  }

  protected lancerV2(force: boolean): void {
    if (!this.verifierPerimetreOutil('bataille_v2')) return;
    this.v2.lancer(force);
  }

  /** « Calculer le score » : la garde n'y refuse que l'absence de filtre — la France entière est admise. */
  protected lancerScore(): void {
    if (!this.verifierPerimetreOutil('score_composite')) return;
    this.scoreComposite.lancer();
  }
}
