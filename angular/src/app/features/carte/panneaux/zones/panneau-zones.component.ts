import { ChangeDetectionStrategy, Component, DestroyRef, type Signal, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CaptureService } from '../../etat/capture.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ParcoursService } from '../../etat/parcours.service';
import { TiroirsExclusifs } from '../../etat/tiroirs-exclusifs';
import { estMetropole } from '../../logique/perimetre-national';
import type { Recette } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
import { CreerPaysComponent } from './creer-pays.component';
import { CreerRayonComponent } from './creer-rayon.component';
import { PiedRecetteComponent } from './pied-recette.component';
import { RecetteImportComponent } from './recette-import.component';
import { RecetteRayonPoiComponent } from './recette-rayon-poi.component';
import { RecetteSeuilCarreauxComponent } from './recette-seuil-carreaux.component';
import { RecetteSeuilTerritoireComponent } from './recette-seuil-territoire.component';

/** Les familles de ③, dans l'ordre de l'arbitrage P25 (la capture en dernier). */
type Famille = 'poi' | 'seuil' | 'main' | 'capture';
/** Les formulaires de recette que le pied peut lancer. */
type CleRecette = 'rayon_poi' | 'seuil_carreaux' | 'seuil_territoire' | 'import';

/** Ce que le panneau lit d'un formulaire de recette pour le pied (P4) : sa recette, et la forme d'une recette figée. */
interface FormulaireRecette {
  readonly recette: Signal<Recette | null>;
  readonly geometrie?: Signal<GeoJSON.Geometry | undefined>;
}

/** Le formulaire qu'une famille rend actif à son ouverture (aucun pour la capture). */
const PREMIER_FORMULAIRE: Readonly<Record<Famille, CleRecette | null>> = {
  poi: 'rayon_poi', seuil: 'seuil_carreaux', main: 'import', capture: null,
};
/** La famille qui porte chaque formulaire : un formulaire d'une famille repliée n'est pas lancé par le pied. */
const FAMILLE_DU_FORMULAIRE: Readonly<Record<CleRecette, Famille>> = {
  rayon_poi: 'poi', seuil_carreaux: 'seuil', seuil_territoire: 'seuil', import: 'main',
};

/** La ligne de périmètre sur la métropole (retours du 26/10, T3) — aucun nombre : la capacité n'est pas une borne produit. */
export const LIGNE_METROPOLE =
  'Périmètre : France métropolitaine — « Autour des POI » s’y calcule ; « Par seuil » sur un département ou une région.';

/**
 * Le panneau de l'étape ③ Zones (lot 3, T10 — spec carte-en-parcours § 16.3) : « Ce que je fabrique », rangé par
 * FAMILLES, quatre sections repliables `mg-entete-section` :
 *
 *   - « Autour des POI » : le rayon autour d'un point (`mg-creer-rayon`, lot 4) et le rayon autour d'un type de POI,
 *     puis le renvoi vers ④ (T11) : isochrones et bataille s'y lancent, inchangées, et leur capture devient une zone ;
 *   - « Par seuil » : carreaux de 200 m, IRIS ou codes postaux au-dessus d'un seuil ;
 *   - « À la main » : le dessin, l'import GeoJSON / KML, la liste de codes postaux, la zone nationale (④ finitions, T6) ;
 *   - « Capture » : le bouton existant, libellé inchangé (arbitrage P25 : en dernier).
 *
 * En tête, la ligne du périmètre de ① — qui borne les familles lourdes. Sous les familles, UN pied
 * (`mg-pied-recette`, arbitrage P4) porte « Aperçu », le nom et « Enregistrer la zone » pour le formulaire de recette
 * ACTIF : le dernier touché (focus, clic) ou, à l'ouverture d'une famille, son premier. Les créateurs du lot 4 (rayon
 * autour d'un point, dessin, codes postaux) gardent leur propre bouton « Créer la zone » et écrivent eux aussi une
 * recette (`CreationZoneService`). Enfin, le renvoi vers « Mes zones » (boîte à outils).
 *
 * ── TIROIRS EXCLUSIFS (retours du 26/10, T7) ─────────────────────────────
 * Les quatre familles sont UN jeu de tiroirs (`TiroirsExclusifs`, « Autour des POI » ouvert à l'ouverture) : en ouvrir
 * une referme l'autre. Une famille repliée CACHE ses formulaires de recette et la liste de codes postaux, montés à son
 * premier dépli (A-12) : la saisie survit au repli, et la rouvrir ne relit rien. Ils ne lisent rien à leur construction
 * hors caches de page, ni sur un changement de filtre (leur recette est un `computed`). Replier la famille active vide
 * `actif` : le pied n'a plus rien à lancer ; la rouvrir rend actif le DERNIER formulaire touché de la famille. Les deux
 * créateurs qui tiennent la CARTE — le rayon autour d'un point (clic de pose, aperçu) et le dessin — restent montés
 * eux aussi (relecture T7, I-1 : centre, rayon, nom, tracé et création en vol survivent, et « Mes zones » se relit
 * quand elle aboutit) ; repliés, ils se mettent EN PAUSE (`enPause`) : pose arrêtée et aperçu retiré pour le rayon,
 * dessin suspendu pour le tracé — la carte est rendue, et tout revient à la réouverture. L'aperçu des recettes est dans
 * `AtelierZoneService`, fourni ICI et donc gardé tant que le panneau l'est (③ → ① → ③).
 *
 * Aucune lecture à l'ouverture de ③ : les types de POI viennent du catalogue de la page (déjà lu par ②), le catalogue
 * d'indicateurs n'est lu qu'à l'ouverture de « Par seuil », fermée par défaut.
 */
@Component({
  selector: 'mg-panneau-zones',
  imports: [
    CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerPaysComponent, CreerRayonComponent, EnteteSectionComponent, IconeComponent,
    PiedRecetteComponent, RecetteImportComponent, RecetteRayonPoiComponent, RecetteSeuilCarreauxComponent, RecetteSeuilTerritoireComponent,
  ],
  // L'atelier (lot 3, T9) au panneau, qui reste monté entre les étapes. Le catalogue d'indicateurs vient de la PAGE (X4).
  providers: [CreationZoneService, AtelierZoneService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <p data-perimetre class="m-0 px-3.5 py-2.5 text-[12px] leading-[1.5]" [class.text-secondary]="!!filtre()" [class.text-tertiary]="!filtre()">{{ lignePerimetre() }}</p>

    <mg-entete-section data-famille="poi" libelle="Autour des POI" repliable [ouvert]="tiroirs.ouvert() === 'poi'" (ouvertChange)="basculer('poi', $event)" />
    @if (tiroirs.dejaOuvert('poi')) {
      <div data-corps-famille="poi" [class.hidden]="tiroirs.ouvert() !== 'poi'">
        <div class="px-3.5 pb-1"><mg-creer-rayon [enPause]="tiroirs.ouvert() !== 'poi'" (cree)="relire()" /></div>
        <mg-recette-rayon-poi #rayonPoi [class.recette-active]="actif() === 'rayon_poi'" (focusin)="actif.set('rayon_poi')" (click)="actif.set('rayon_poi')" />
        <p data-renvoi-analyse class="m-0 px-3.5 pt-2 text-[12px] leading-[1.5] text-tertiary">
          La bataille d’isochrones se lance à l’étape ④ ; capturez ensuite son résultat ici.
        </p>
        <button type="button" data-aller-analyse (click)="parcours.choisir('analyse')"
          class="mx-3.5 mb-3 mt-1 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-3 py-1.5 text-[12px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary">Aller à ④ Analyse</button>
      </div>
    }

    <mg-entete-section data-famille="seuil" libelle="Par seuil" repliable [ouvert]="tiroirs.ouvert() === 'seuil'" (ouvertChange)="basculer('seuil', $event)" />
    @if (tiroirs.dejaOuvert('seuil')) {
      <div data-corps-famille="seuil" [class.hidden]="tiroirs.ouvert() !== 'seuil'">
        <mg-recette-seuil-carreaux #seuilCarreaux [class.recette-active]="actif() === 'seuil_carreaux'" (focusin)="actif.set('seuil_carreaux')" (click)="actif.set('seuil_carreaux')" />
        <mg-recette-seuil-territoire #seuilTerritoire [class.recette-active]="actif() === 'seuil_territoire'" (focusin)="actif.set('seuil_territoire')" (click)="actif.set('seuil_territoire')" />
      </div>
    }

    <mg-entete-section data-famille="main" libelle="À la main" repliable [ouvert]="tiroirs.ouvert() === 'main'" (ouvertChange)="basculer('main', $event)" />
    @if (tiroirs.dejaOuvert('main')) {
      <div data-corps-famille="main" [class.hidden]="tiroirs.ouvert() !== 'main'">
        <div class="px-3.5 pb-1"><mg-creer-dessin [enPause]="tiroirs.ouvert() !== 'main'" (cree)="relire()" /></div>
        <mg-recette-import #importForme [class.recette-active]="actif() === 'import'" (focusin)="actif.set('import')" (click)="actif.set('import')" />
        <div class="px-3.5 pb-3"><mg-creer-codes-postaux (cree)="relire()" /></div>
        <!-- ④ finitions (T6, A-3) : la zone nationale, prête, sans formulaire (campagne nationale, décision du 25/10). -->
        <div class="px-3.5 pb-3"><mg-creer-pays (cree)="relire()" /></div>
      </div>
    }

    <mg-entete-section data-famille="capture" libelle="Capture" repliable [ouvert]="tiroirs.ouvert() === 'capture'" (ouvertChange)="basculer('capture', $event)" />
    @if (tiroirs.ouvert() === 'capture') {
      <div class="px-3.5 py-3">
        <button
          type="button"
          data-capturer
          class="capturer flex w-full items-center justify-center gap-2 rounded-[6px] border-fin px-4 py-2 text-[12px] font-medium"
          [class.inactif]="captureInactive()"
          [disabled]="captureInactive()"
          [title]="captureInactive() ? 'Aucune zone à capturer (active au moins un layer terrain)' : 'Capturer la vue comme zone custom'"
          (click)="captureOuverte.set(true)"
        >
          <mg-icone nom="enregistrer" [taille]="14" [trait]="1.5" />
          Capturer zone custom
          @if (compte() > 0) {
            <span data-badge class="badge ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-teal px-[5px] font-mono text-[10px] font-bold text-teal-fg">{{ compte() }}</span>
          }
        </button>
      </div>
    }
    @if (captureOuverte()) {
      <mg-capture (fermer)="captureOuverte.set(false)" (cree)="relire()" />
    }

    <mg-pied-recette [recette]="recetteActive()" [geometrie]="geometrieActive()" />

    <section data-section="vers-mes-zones" class="border-t-fin border-subtle px-4 py-3">
      <p class="m-0 text-[12px] leading-[1.5] text-tertiary">Vos zones et jeux de zones enregistrés sont dans la boîte à outils.</p>
      <button type="button" data-ouvrir-mes-zones (click)="outils.ouvrir('zones')"
              class="mt-2 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-3 py-1.5 text-[12px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary">Ouvrir « Mes zones »</button>
    </section>
  `,
  styles: `
    .capturer { background: transparent; border-color: var(--brand-teal); color: var(--brand-teal); cursor: pointer;
      transition: background-color 150ms var(--ease-hover); }
    .capturer:hover:not(:disabled) { background: var(--brand-teal-10); }
    .capturer.inactif { border-color: var(--border-default); color: var(--text-tertiary); cursor: not-allowed; opacity: 0.5; }
    mg-recette-rayon-poi, mg-recette-seuil-carreaux, mg-recette-seuil-territoire, mg-recette-import { border-left: 2px solid transparent; }
    .recette-active { border-left-color: var(--brand-teal); }
  `,
})
export class PanneauZonesComponent {
  protected readonly compte = inject(CaptureService).compte;
  protected readonly captureInactive = computed(() => this.compte() === 0);
  protected readonly captureOuverte = signal(false);
  protected readonly outils = inject(OutilsCarteService);
  /** Le renvoi vers ④ (T11) : le service du fil, fourni par la page (lot 1). */
  protected readonly parcours = inject(ParcoursService);
  protected readonly filtre = inject(EtatCarteService).filtre;

  /** Une famille ouverte à la fois ; « Autour des POI » à l'ouverture (A-11). */
  protected readonly tiroirs = new TiroirsExclusifs<Famille>('poi');
  protected readonly actif = signal<CleRecette | null>('rayon_poi');
  /** Le dernier formulaire actif de chaque famille : la rouvrir le rend actif (relecture T7, m-1), le premier sinon. */
  private readonly derniers: Partial<Record<Famille, CleRecette>> = {};

  // Par référence de gabarit (le contrat `FormulaireRecette`, pas la classe) : `undefined` tant que sa famille n'a jamais été dépliée.
  private readonly rayonPoi = viewChild<FormulaireRecette>('rayonPoi');
  private readonly seuilCarreaux = viewChild<FormulaireRecette>('seuilCarreaux');
  private readonly seuilTerritoire = viewChild<FormulaireRecette>('seuilTerritoire');
  private readonly importForme = viewChild<FormulaireRecette>('importForme');

  /** Le formulaire actif s'il est monté ET sa famille dépliée (une famille repliée cache ses formulaires : rien à lancer). */
  private readonly formulaire = computed(() => {
    const actif = this.actif();
    if (!actif || !this.tiroirs.estOuvert(FAMILLE_DU_FORMULAIRE[actif])) return undefined;
    switch (actif) {
      case 'rayon_poi': return this.rayonPoi();
      case 'seuil_carreaux': return this.seuilCarreaux();
      case 'seuil_territoire': return this.seuilTerritoire();
      case 'import': return this.importForme();
      default: return undefined;
    }
  });
  protected readonly recetteActive = computed(() => this.formulaire()?.recette() ?? null);
  protected readonly geometrieActive = computed(() => this.formulaire()?.geometrie?.());

  /** La métropole (pastille « France Metro », retours du 26/10) dit ce qui s'y calcule : « Par seuil » vient plus tard. */
  protected readonly lignePerimetre = computed(() => {
    const f = this.filtre();
    if (estMetropole(f)) return LIGNE_METROPOLE;
    return f
      ? `Périmètre : ${f.label}`
      : 'Aucun périmètre : les calculs par seuil et autour des POI sont désactivés. Choisissez-en un à l’étape ①.';
  });

  constructor() {
    const atelier = inject(AtelierZoneService);
    const ecrite = atelier.zoneCreee.subscribe(() => this.relire());
    inject(DestroyRef).onDestroy(() => ecrite.unsubscribe());
    // ③ finitions (T6, A-9) : le message de réussite s'efface quand le formulaire actif (donc la famille) ou sa recette
    // change ; un clic sur le formulaire déjà actif ne change rien, le message reste.
    effect(() => {
      this.actif();
      this.recetteActive();
      untracked(() => atelier.oublierMessage());
    });
  }

  /** Ouvrir une famille referme l'autre et rend actif son dernier formulaire (le premier sinon) ; replier vide `actif`. */
  protected basculer(famille: Famille, ouvert: boolean): void {
    // L'actif de la famille qui se replie (explicitement, ou parce qu'une autre s'ouvre) est retenu pour sa réouverture.
    const actif = this.actif();
    if (actif) this.derniers[FAMILLE_DU_FORMULAIRE[actif]] = actif;
    if (ouvert) {
      this.tiroirs.ouvrir(famille);
      this.actif.set(this.derniers[famille] ?? PREMIER_FORMULAIRE[famille]);
    } else if (this.tiroirs.estOuvert(famille)) {
      this.tiroirs.fermer();
      this.actif.set(null);
    }
  }

  /** Une zone créée : « Mes zones », dans la boîte à outils, se relit sans être recréé (sa sélection survit). */
  protected relire(): void {
    this.outils.zonesModifiees();
  }
}
