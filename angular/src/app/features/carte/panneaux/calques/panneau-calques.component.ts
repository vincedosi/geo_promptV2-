import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { CarreauxService } from '../../couches/carreaux.service';
import { IrisService } from '../../couches/iris.service';
import { libelleDegrade } from '../../logique/degrades';
import { GroupeCalquesComponent } from './groupe-calques.component';
import { SectionCarreauxComponent } from './section-carreaux.component';
import { SectionIrisComponent } from './section-iris.component';

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
 * T6 a porté le CADRE et les carreaux Filosofi, T7 les IRIS ; chaque groupe se remplit dans sa tâche :
 * POI/transport/TMJA (T8-T9), OOH/radio (T8-T9), environnement (T10-T12), « Mes analyses » (T18). Les sections
 * internes de ces groupes (`useFilterSections(true, …)` en mode overlay) ne mémorisent rien non plus : leur logique
 * pure attend dans `etat/sections-filtre.ts`, à brancher par la tâche qui en aura l'usage.
 * « Campagne active » n'est pas rendu : il n'existe qu'avec une campagne active, qui relève du lot 5 (arbitrage B6).
 * « Mes analyses » ne lance AUCUNE requête ici — React y chargeait `GET /api/analyses` au premier dépliage.
 */
@Component({
  selector: 'mg-panneau-calques',
  imports: [GroupeCalquesComponent, IconeComponent, SectionCarreauxComponent, SectionIrisComponent],
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

    <mg-groupe-calques titre="POI et mobilité" [ouvert]="groupes().poiMobilite" (basculer)="basculer('poiMobilite')">
      @if (groupes().poiMobilite) {
        <p data-provisoire class="px-4 py-2 text-[12px] text-tertiary">Les POI, le transport et le flux routier arrivent avec les tâches 8 et 9.</p>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="Médias offline" [ouvert]="groupes().mediasOffline" (basculer)="basculer('mediasOffline')">
      @if (groupes().mediasOffline) {
        <p data-provisoire class="px-4 py-2 text-[12px] text-tertiary">Les panneaux OOH et la radio arrivent avec les tâches 8 et 9.</p>
      }
    </mg-groupe-calques>

    <mg-groupe-calques titre="Environnement" [ouvert]="groupes().environnement" (basculer)="basculer('environnement')">
      @if (groupes().environnement) {
        <p data-provisoire class="px-4 py-2 text-[12px] text-tertiary">Les risques, les indicateurs civiques, la santé environnementale et la météo arrivent avec les tâches 10 à 12.</p>
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

  protected readonly groupes = signal<Record<CleGroupe, boolean>>({
    socioDemo: false, poiMobilite: false, mediasOffline: false, environnement: false, analyses: false,
  });

  protected readonly compteSocio = computed(() => (this.carreaux.visible() ? 1 : 0) + (this.iris.visible() ? 1 : 0));
  protected readonly actifs = computed<ActifCalque[]>(() => {
    const liste: ActifCalque[] = [];
    if (this.carreaux.visible()) {
      liste.push({ id: 'carreaux', label: libelleDegrade('carreaux'), retirer: () => this.carreaux.basculer(false) });
    }
    if (this.iris.visible()) {
      liste.push({ id: 'iris', label: libelleDegrade('iris'), retirer: () => this.iris.basculer(false) });
    }
    return liste;
  });

  protected basculer(cle: CleGroupe): void {
    this.groupes.update((g) => ({ ...g, [cle]: !g[cle] }));
  }
}
