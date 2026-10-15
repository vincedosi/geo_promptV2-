import { ChangeDetectionStrategy, Component, DestroyRef, type Signal, type WritableSignal, computed, inject, signal, viewChild } from '@angular/core';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CaptureService } from '../../etat/capture.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import type { Recette } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
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

/**
 * Le panneau de l'étape ③ Zones (lot 3, T10 — spec carte-en-parcours § 16.3) : « Ce que je fabrique », rangé par
 * FAMILLES, quatre sections repliables `mg-entete-section` :
 *
 *   - « Autour des POI » : le rayon autour d'un point (`mg-creer-rayon`, lot 4) et le rayon autour d'un type de POI ;
 *   - « Par seuil » : carreaux de 200 m, IRIS ou codes postaux au-dessus d'un seuil ;
 *   - « À la main » : le dessin, l'import GeoJSON / KML, la liste de codes postaux ;
 *   - « Capture » : le bouton existant, libellé inchangé (arbitrage P25 : en dernier).
 *
 * En tête, la ligne du périmètre de ① — qui borne les familles lourdes. Sous les familles, UN pied
 * (`mg-pied-recette`, arbitrage P4) porte « Aperçu », le nom et « Enregistrer la zone » pour le formulaire de recette
 * ACTIF : le dernier touché (focus, clic) ou, à l'ouverture d'une famille, son premier. Les créateurs du lot 4 (rayon
 * autour d'un point, dessin, codes postaux) gardent leur propre bouton « Créer la zone » et écrivent eux aussi une
 * recette (`CreationZoneService`). Enfin, le renvoi vers « Mes zones » (boîte à outils).
 *
 * Une famille repliée DÉMONTE ses formulaires (`@if`) : aucun calcul n'y vit — l'aperçu est dans `AtelierZoneService`,
 * fourni ICI et donc gardé tant que le panneau l'est (③ → ① → ③). Replier « À la main » pendant un tracé arrête le
 * dessin et rend la carte (destruction de `mg-creer-dessin`).
 *
 * Aucune lecture à l'ouverture de ③ : les types de POI viennent du catalogue de la page (déjà lu par ②), le catalogue
 * d'indicateurs n'est lu qu'à l'ouverture de « Par seuil », fermée par défaut.
 */
@Component({
  selector: 'mg-panneau-zones',
  imports: [
    CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent, EnteteSectionComponent, IconeComponent,
    PiedRecetteComponent, RecetteImportComponent, RecetteRayonPoiComponent, RecetteSeuilCarreauxComponent, RecetteSeuilTerritoireComponent,
  ],
  // L'atelier (lot 3, T9) et le catalogue d'indicateurs au panneau, qui reste monté entre les étapes.
  providers: [CreationZoneService, AtelierZoneService, CatalogueIndicateursService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <p data-perimetre class="m-0 px-3.5 py-2.5 text-[12px] leading-[1.5]" [class.text-secondary]="!!filtre()" [class.text-tertiary]="!filtre()">{{ lignePerimetre() }}</p>

    <mg-entete-section data-famille="poi" libelle="Autour des POI" repliable [ouvert]="ouverts.poi()" (ouvertChange)="basculer('poi', $event)" />
    @if (ouverts.poi()) {
      <div class="px-3.5 pb-1"><mg-creer-rayon (cree)="relire()" /></div>
      <mg-recette-rayon-poi #rayonPoi [class.recette-active]="actif() === 'rayon_poi'" (focusin)="actif.set('rayon_poi')" (click)="actif.set('rayon_poi')" />
    }

    <mg-entete-section data-famille="seuil" libelle="Par seuil" repliable [ouvert]="ouverts.seuil()" (ouvertChange)="basculer('seuil', $event)" />
    @if (ouverts.seuil()) {
      <mg-recette-seuil-carreaux #seuilCarreaux [class.recette-active]="actif() === 'seuil_carreaux'" (focusin)="actif.set('seuil_carreaux')" (click)="actif.set('seuil_carreaux')" />
      <mg-recette-seuil-territoire #seuilTerritoire [class.recette-active]="actif() === 'seuil_territoire'" (focusin)="actif.set('seuil_territoire')" (click)="actif.set('seuil_territoire')" />
    }

    <mg-entete-section data-famille="main" libelle="À la main" repliable [ouvert]="ouverts.main()" (ouvertChange)="basculer('main', $event)" />
    @if (ouverts.main()) {
      <div class="px-3.5 pb-1"><mg-creer-dessin (cree)="relire()" /></div>
      <mg-recette-import #importForme [class.recette-active]="actif() === 'import'" (focusin)="actif.set('import')" (click)="actif.set('import')" />
      <div class="px-3.5 pb-3"><mg-creer-codes-postaux (cree)="relire()" /></div>
    }

    <mg-entete-section data-famille="capture" libelle="Capture" repliable [ouvert]="ouverts.capture()" (ouvertChange)="basculer('capture', $event)" />
    @if (ouverts.capture()) {
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
  protected readonly filtre = inject(EtatCarteService).filtre;

  protected readonly ouverts: Readonly<Record<Famille, WritableSignal<boolean>>> = {
    poi: signal(true), seuil: signal(false), main: signal(false), capture: signal(false),
  };
  protected readonly actif = signal<CleRecette | null>('rayon_poi');

  // Par référence de gabarit (le contrat `FormulaireRecette`, pas la classe) : `undefined` quand la famille est repliée.
  private readonly rayonPoi = viewChild<FormulaireRecette>('rayonPoi');
  private readonly seuilCarreaux = viewChild<FormulaireRecette>('seuilCarreaux');
  private readonly seuilTerritoire = viewChild<FormulaireRecette>('seuilTerritoire');
  private readonly importForme = viewChild<FormulaireRecette>('importForme');

  /** Le formulaire actif s'il est MONTÉ (une famille repliée n'a plus de formulaire : rien à lancer). */
  private readonly formulaire = computed(() => {
    switch (this.actif()) {
      case 'rayon_poi': return this.rayonPoi();
      case 'seuil_carreaux': return this.seuilCarreaux();
      case 'seuil_territoire': return this.seuilTerritoire();
      case 'import': return this.importForme();
      default: return undefined;
    }
  });
  protected readonly recetteActive = computed(() => this.formulaire()?.recette() ?? null);
  protected readonly geometrieActive = computed(() => this.formulaire()?.geometrie?.());

  protected readonly lignePerimetre = computed(() => {
    const f = this.filtre();
    return f
      ? `Périmètre : ${f.label}`
      : 'Aucun périmètre : les calculs par seuil et autour des POI sont désactivés. Choisissez-en un à l’étape ①.';
  });

  constructor() {
    const ecrite = inject(AtelierZoneService).zoneCreee.subscribe(() => this.relire());
    inject(DestroyRef).onDestroy(() => ecrite.unsubscribe());
  }

  protected basculer(famille: Famille, ouvert: boolean): void {
    this.ouverts[famille].set(ouvert);
    const premier = PREMIER_FORMULAIRE[famille];
    if (ouvert && premier) this.actif.set(premier);
  }

  /** Une zone créée : « Mes zones », dans la boîte à outils, se relit sans être recréé (sa sélection survit). */
  protected relire(): void {
    this.outils.zonesModifiees();
  }
}
