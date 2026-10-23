import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { ClustersService } from '../../couches/clusters.service';
import { BatailleV1Service } from '../../etat/bataille-v1.service';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import { CouvertureRayonService } from '../../etat/couverture-rayon.service';
import { ScoreCompositeService } from '../../etat/score-composite.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import type { FiltreActif } from '../../logique/filtre';
import { messageRefusTerritoireBataille } from '../../logique/bataille/parametres';
import { type OutilAnalyse, messageGardeOutil, messageGardePerimetre } from '../../logique/garde-perimetre';
import { ISO_MODES } from '../../logique/modes-isochrones';
import type { CorpsLancementClustering } from '../../logique/clustering/assistant';
import { CalculClusteringService } from './clustering/calcul-clustering.service';
import { SectionClusteringComponent } from './clustering/section-clustering.component';
import { IntroAnalyseComponent } from './intro-analyse.component';
import { OutilBatailleV2Component } from './outil-bataille-v2.component';
import { OutilCorrelationComponent } from './outil-correlation.component';
import { OutilCouvertureComponent } from './outil-couverture.component';
import { OutilIsochronesComponent } from './outil-isochrones.component';
import { OutilRayonComponent } from './outil-rayon.component';
import { OutilScoreComponent } from './outil-score.component';
import { ENTETE_ACCORDEON, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/** L'outil déplié : les deux s'excluent (chacun ferme l'autre, `PanneauAnalyse.tsx:176-179`). */
type OutilOuvert = 'bataille-v2' | 'isochrones' | null;

/**
 * Le panneau « Analyse » de la carte — portage de `app/map/_components/panneaux/PanneauAnalyse.tsx` (lot 4, T17) :
 * le message de garde, puis l'accordéon « Analyse spatiale » (encarts d'accueil, mode de transport, Bataille V2,
 * Isochrones routiers), puis les accordéons « Score composite » et « Corrélation » (T18), puis « Clustering » (T19,
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
 * Le territoire des batailles vient du FILTRE (`ContexteBatailleService`), pas du sélecteur de périmètre, code mort
 * côté React depuis la refonte du panneau Filtre. Un filtre code postal ou zone passe la garde mais n'est PAS transmis
 * à la bataille : React la lançait alors sur toute la métropole. Ici, elle est REFUSÉE avec un message
 * (`messageRefusTerritoireBataille`) — défaut React corrigé, revue finale du lot 4 (registre, ligne 71).
 */
@Component({
  selector: 'mg-panneau-analyse',
  imports: [
    IntroAnalyseComponent, OutilBatailleV2Component, OutilCorrelationComponent, OutilCouvertureComponent, OutilIsochronesComponent,
    OutilRayonComponent, OutilScoreComponent, SectionClusteringComponent,
  ],
  // Le catalogue d'indicateurs (score, corrélation) vient de la PAGE (lot 3, X4), partagé avec ③ et « Mes zones ».
  // La couverture par rayon (T12) aussi : le panneau reste monté (P-e), sa couche se retire avec lui.
  providers: [ScoreCompositeService, CouvertureRayonService, CreationZoneService, CalculClusteringService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    @if (gardeMessage(); as m) {
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
          @if (zoneAnalysee()) { <div data-perimetre-etape-1 [class]="lignePerimetre">{{ messagePerimetre }}</div> }
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
                  [ouvert]="outilOuvert() === 'bataille-v2'"
                  (basculer)="basculerOutil('bataille-v2')"
                  (verifierCache)="verifierCacheV2()"
                  (remplir)="remplirV2()"
                  (lancer)="lancerV2($event)"
                />
                <mg-outil-isochrones
                  [ouvert]="outilOuvert() === 'isochrones'"
                  (basculer)="basculerOutil('isochrones')"
                  (verifierCache)="verifierCacheV1()"
                  (lancer)="lancerV1($event)"
                  (appliquer)="appliquerBataille()"
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
    @if (clusteringOuvert() && zoneAnalysee()) { <div data-perimetre-etape-1 [class]="lignePerimetre + ' mx-[14px] mt-[10px]'">{{ messagePerimetre }}</div> }
    @if (clusteringOuvert()) { <mg-section-clustering [refusCalcul]="gardeMessage()" (charger)="chargerClusters()" (lancerCalcul)="lancerClustering($event)" /> }
  `,
})
export class PanneauAnalyseComponent {
  private readonly etat = inject(EtatCarteService);
  protected readonly contexte = inject(ContexteBatailleService);
  private readonly v1 = inject(BatailleV1Service);
  private readonly v2 = inject(BatailleV2Service);
  private readonly clusters = inject(ClustersService);
  private readonly calculClustering = inject(CalculClusteringService);

  private readonly scoreComposite = inject(ScoreCompositeService);
  /**
   * A-9 (lot 4) : quand une zone est analysée, les batailles et le clustering — qui ne savent pas la prendre — disent
   * en une ligne sur quoi ils travaillent.
   */
  private readonly analysee = inject(ZoneAnalyseeService);
  protected readonly zoneAnalysee = computed(() => this.analysee.zoneId() !== null);
  protected readonly messagePerimetre = 'Cet outil travaille sur le périmètre de l’étape ①.';
  protected readonly lignePerimetre = 'mb-2 text-[11px] leading-[1.5] text-tertiary';

  protected readonly modes = ISO_MODES;
  protected readonly entete = ENTETE_ACCORDEON;
  protected readonly pastille = PASTILLE;
  protected readonly pastillePrimaire = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  /** Fermé à l'ouverture du panneau, comme React (`analyseOpen.spatiale: false`). */
  protected readonly spatialeOuverte = signal(false);
  protected readonly outilOuvert = signal<OutilOuvert>(null);
  protected readonly nombrePoi = computed(() => this.etat.poiSelectionnes().length);
  /** L'outil du dernier refus : seule la zone analysée du SCORE efface son refus (T10 R-1 — la bataille ne la lit pas). */
  private readonly outilRefuse = signal<OutilAnalyse | null>(null);
  /** Le dernier refus ; un filtre posé l'efface (`useEffect(() => { if (filtre) setGardeMessage(null) })`). */
  protected readonly gardeMessage = linkedSignal<FiltreActif | string | null, string | null>({
    // Une zone analysée est un périmètre suffisant pour le score (T10) : la choisir efface le refus du score, pas des autres.
    source: computed(() => this.etat.filtre() ?? (this.outilRefuse() === 'score_composite' ? this.scoreComposite.zoneScore() : null)),
    computation: (perimetre, precedent) => (perimetre ? null : (precedent?.value ?? null)),
  });

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

  protected basculerOutil(outil: Exclude<OutilOuvert, null>): void {
    this.outilOuvert.update((o) => (o === outil ? null : outil));
  }

  /**
   * La garde, pour UN outil : le message affiché, `true` si le calcul peut partir (`messageGardeOutil`). Les deux
   * batailles refusent EN PLUS un filtre qu'elles ne savent pas transmettre (code postal, zone) : sans lui, elles
   * partiraient sur toute la métropole (`messageRefusTerritoireBataille`, défaut React corrigé). L'application de la
   * bataille n'est pas concernée : elle découpe des anneaux déjà calculés, sans territoire.
   */
  protected verifierPerimetreOutil(outil: OutilAnalyse): boolean {
    const bataille = outil === 'bataille_v1' || outil === 'bataille_v2';
    // Seul le score sait lire une zone : pour lui, la zone analysée tient lieu de périmètre (lot 4, T10).
    const zone = outil === 'score_composite' ? this.scoreComposite.zoneScore() : null;
    const message = messageGardeOutil(outil, this.etat.filtre(), zone)
      ?? (bataille ? messageRefusTerritoireBataille(this.etat.filtre()) : null);
    this.outilRefuse.set(outil);
    this.gardeMessage.set(message);
    return message === null;
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

  protected verifierCacheV1(): void {
    if (!this.verifierPerimetreOutil('bataille_v1')) return;
    this.v1.verifierCache();
  }

  protected lancerV1(force: boolean): void {
    if (!this.verifierPerimetreOutil('bataille_v1')) return;
    this.v1.lancer(force);
  }

  /** « X BATAILLE (ST_Difference) » : un second calcul PostGIS, distinct du lancement — gardé à part. */
  protected appliquerBataille(): void {
    if (!this.verifierPerimetreOutil('application_bataille')) return;
    this.v1.appliquer();
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
