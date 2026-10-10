import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { CarreauxService } from '../../couches/carreaux.service';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import { IrisService } from '../../couches/iris.service';
import { MeteoService } from '../../couches/meteo.service';
import { RadioService } from '../../couches/radio.service';
import { SanteService } from '../../couches/sante.service';
import { TmjaService } from '../../couches/tmja.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { libelleDegrade } from '../../logique/degrades';
import { GroupeCalquesComponent } from './groupe-calques.component';
import { SectionCarreauxComponent } from './section-carreaux.component';
import { SectionCiviqueComponent } from './section-civique.component';
import { SectionIrisComponent } from './section-iris.component';
import { SectionMeteoComponent } from './section-meteo.component';
import { SectionOohComponent } from './section-ooh.component';
import { SectionPoiComponent } from './section-poi.component';
import { SectionRadioComponent } from './section-radio.component';
import { SectionSanteComponent } from './section-sante.component';
import { SectionTmjaComponent } from './section-tmja.component';
import { SectionTransportComponent } from './section-transport.component';
import { SelectionsCalquesService } from './selections-calques.service';

type CleGroupe = 'socioDemo' | 'poiMobilite' | 'mediasOffline' | 'environnement' | 'analyses';

/** Un calque affiché, dans « Actifs (n) », avec la croix qui l'éteint (`PanneauCalques.tsx:327-358`). */
interface ActifCalque {
  readonly id: string;
  readonly label: string;
  readonly retirer: () => void;
}

/**
 * Le panneau « Calques » du rail (« ce que je vois ») — portage de `app/map/_components/panneaux/PanneauCalques.tsx`.
 *
 * « Actifs (n) » puis les groupes repliables, dans l'ordre de React : Socio-démographie, [Campagne active], POI et
 * mobilité, Médias offline, Environnement, Mes analyses. Tous fermés à l'ouverture, et rien n'est mémorisé : comme
 * React (`useState`, `PanneauCalques.tsx:240-243`), le panneau repart replié à chaque réouverture.
 *
 * T6 a porté le CADRE et les carreaux Filosofi, T7 les IRIS, T8 les POI, le transport et les panneaux OOH, T9 le flux
 * routier (TMJA) et la radio, T10 les indicateurs civiques et la santé environnementale, T11 la météo ; chaque groupe se
 * remplit dans sa tâche : risques industriels (T12), « Mes analyses » (T18). Les sections
 * internes de ces groupes (`useFilterSections(true, …)` en mode overlay) ne mémorisent rien non plus : leur état, les
 * régies OOH et les types de transport choisis vivent dans `SelectionsCalquesService`, fourni par CE composant — il
 * survit au repli d'un groupe et disparaît à la fermeture du panneau, comme l'état React.
 * « Campagne active » n'est pas rendu : il n'existe qu'avec une campagne active, qui relève du lot 5 (arbitrage B6).
 * « Mes analyses » ne lance AUCUNE requête ici — React y chargeait `GET /api/analyses` au premier dépliage.
 */
@Component({
  selector: 'mg-panneau-calques',
  imports: [
    GroupeCalquesComponent, IconeComponent, SectionCarreauxComponent, SectionCiviqueComponent, SectionIrisComponent, SectionMeteoComponent,
    SectionOohComponent, SectionPoiComponent, SectionRadioComponent, SectionSanteComponent, SectionTmjaComponent,
    SectionTransportComponent,
  ],
  providers: [SelectionsCalquesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <div data-actifs class="border-b-fin border-subtle">
      <div class="px-[14px] py-[10px] text-[12px] font-medium text-primary">Actifs ({{ actifs().length }})</div>
      @if (actifs().length > 0) {
        <div class="flex flex-col gap-1 px-[14px] pb-[10px]">
          @for (a of actifs(); track a.id) {
            <div [attr.data-actif]="a.id" class="flex items-center gap-2 rounded-[4px] border-fin border-subtle bg-elevated px-2 py-[5px]">
              <span class="flex-1 text-[12px] text-secondary">{{ a.label }}</span>
              <button
                type="button"
                [title]="'Masquer ' + a.label"
                [attr.aria-label]="'Masquer ' + a.label"
                (click)="a.retirer()"
                class="flex cursor-pointer border-0 bg-transparent p-0 text-tertiary"
              >
                <mg-icone nom="croix" [taille]="13" />
              </button>
            </div>
          }
        </div>
      } @else {
        <div class="px-[14px] pb-[10px] text-[12px] text-tertiary">Aucun calque affiché</div>
      }
    </div>

    <mg-groupe-calques titre="Socio-démographie" [ouvert]="groupes().socioDemo" [compte]="compteSocio()" (basculer)="basculer('socioDemo')">
      @if (groupes().socioDemo) {
        <div class="flex flex-col">
          <mg-section-carreaux />
          <mg-section-iris />
        </div>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="POI et mobilité" [ouvert]="groupes().poiMobilite" [compte]="comptePoi()" (basculer)="basculer('poiMobilite')">
      @if (groupes().poiMobilite) {
        <!-- PanneauCalques.tsx:470-525 : padding 16, sections espacées de 16. -->
        <div class="flex flex-col gap-4 p-4">
          <mg-section-poi />
          <mg-section-transport />
          <mg-section-tmja />
        </div>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="Médias offline" [ouvert]="groupes().mediasOffline" [compte]="compteMedias()" (basculer)="basculer('mediasOffline')">
      @if (groupes().mediasOffline) {
        <!-- PanneauCalques.tsx:527-575. -->
        <div class="flex flex-col gap-4 p-4">
          <mg-section-ooh />
          <mg-section-radio />
        </div>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="Environnement" [ouvert]="groupes().environnement" [compte]="compteEnvironnement()" (basculer)="basculer('environnement')">
      @if (groupes().environnement) {
        <p data-provisoire class="px-4 pt-2 text-[12px] text-tertiary">Les risques industriels arrivent avec la tâche 12.</p>
        <!-- PanneauCalques.tsx:600-637 : padding 16, sections espacées de 16. -->
        <div class="flex flex-col gap-4 p-4">
          <mg-section-civique />
          <mg-section-sante />
          <mg-section-meteo />
        </div>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="Mes analyses" [ouvert]="groupes().analyses" (basculer)="basculer('analyses')">
      @if (groupes().analyses) {
        <p data-provisoire class="px-4 py-2 text-[12px] text-tertiary">Les analyses enregistrées arrivent avec la tâche 18.</p>
      }
    </mg-groupe-calques>
  `,
})
export class PanneauCalquesComponent {
  private readonly carreaux = inject(CarreauxService);
  private readonly iris = inject(IrisService);
  private readonly etat = inject(EtatCarteService);
  private readonly selections = inject(SelectionsCalquesService);
  private readonly tmja = inject(TmjaService);
  private readonly radio = inject(RadioService);
  private readonly civique = inject(IndicateursCiviquesService);
  private readonly sante = inject(SanteService);
  private readonly meteo = inject(MeteoService);

  protected readonly groupes = signal<Record<CleGroupe, boolean>>({
    socioDemo: false, poiMobilite: false, mediasOffline: false, environnement: false, analyses: false,
  });

  protected readonly compteSocio = computed(() => (this.carreaux.visible() ? 1 : 0) + (this.iris.visible() ? 1 : 0));
  /** `selectedPOI.length + selectedTransportTypes.length + (tmjaVisible ? 1 : 0)` (`PanneauCalques.tsx:472`). */
  protected readonly comptePoi = computed(
    () => this.etat.poiSelectionnes().length + this.selections.typesTransport().length + (this.tmja.visible() ? 1 : 0),
  );
  /** `selectedOOH.length + (radioVisible ? 1 : 0)` (`PanneauCalques.tsx:529`). */
  protected readonly compteMedias = computed(() => this.selections.regiesOoh().length + (this.radio.visible() ? 1 : 0));
  /** `(civicVariableCode ? 1 : 0) + (civicHealthLayer ? 1 : 0) + (meteoVisible ? 1 : 0)` (`PanneauCalques.tsx:575`) — risques : T12. */
  protected readonly compteEnvironnement = computed(
    () => (this.civique.variable() ? 1 : 0) + (this.sante.jeu() ? 1 : 0) + (this.meteo.visible() ? 1 : 0),
  );
  protected readonly actifs = computed<ActifCalque[]>(() => {
    const liste: ActifCalque[] = [];
    if (this.carreaux.visible()) {
      liste.push({ id: 'carreaux', label: libelleDegrade('carreaux'), retirer: () => this.carreaux.basculer(false) });
    }
    if (this.iris.visible()) {
      liste.push({ id: 'iris', label: libelleDegrade('iris'), retirer: () => this.iris.basculer(false) });
    }
    // `PanneauCalques.tsx:332-335` : la croix vide la SÉLECTION, elle n'efface pas les points affichés (comme React).
    const poi = this.etat.poiSelectionnes().length;
    if (poi > 0) liste.push({ id: 'poi', label: `POI (${poi})`, retirer: () => this.etat.poiSelectionnes.set([]) });
    const transport = this.selections.typesTransport().length;
    if (transport > 0) {
      liste.push({ id: 'transport', label: `Transport (${transport})`, retirer: () => this.selections.typesTransport.set([]) });
    }
    if (this.tmja.visible()) liste.push({ id: 'tmja', label: 'Flux routier (TMJA)', retirer: () => this.tmja.masquer() });
    const ooh = this.selections.regiesOoh().length;
    if (ooh > 0) liste.push({ id: 'ooh', label: `OOH (${ooh} régies)`, retirer: () => this.selections.regiesOoh.set([]) });
    // `PanneauCalques.tsx:336` : la croix fait `onToggleRadio`, donc ÉTEINT le calque.
    if (this.radio.visible()) liste.push({ id: 'radio', label: 'Radio FM/DAB+', retirer: () => this.radio.basculer() });
    if (this.civique.variable()) {
      liste.push({ id: 'civic-indicateurs', label: libelleDegrade('civic-indicateurs'), retirer: () => this.civique.choisir(null) });
    }
    if (this.sante.jeu()) liste.push({ id: 'civic-sante', label: libelleDegrade('civic-sante'), retirer: () => this.sante.choisirJeu(null) });
    // `PanneauCalques.tsx:339` : la croix fait `onClearMeteo` — dégradé rendu ET couche vidée.
    if (this.meteo.visible()) liste.push({ id: 'meteo', label: libelleDegrade('meteo'), retirer: () => this.meteo.masquer() });
    return liste;
  });

  constructor() {
    // « Santé environnementale » s'ouvre d'elle-même au PREMIER IRIS sélectionné, une seule fois : refermée ensuite, elle
    // le reste (`use-filter-sections.ts:85-91`, même durée de vie : celle du panneau).
    let ouverteAuto = false;
    effect(() => {
      const commune = this.iris.detail()?.code_commune;
      if (!commune || ouverteAuto) return;
      ouverteAuto = true;
      untracked(() => {
        if (!this.selections.sections()['civicHealth']) this.selections.basculerSection('civicHealth');
      });
    });
  }

  protected basculer(cle: CleGroupe): void {
    this.groupes.update((g) => ({ ...g, [cle]: !g[cle] }));
  }
}
