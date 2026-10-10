import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BatailleService } from '../../couches/bataille.service';
import { BatailleV1Service } from '../../etat/bataille-v1.service';
import { ISO_DURATIONS } from '../../logique/modes-isochrones';
import { JournalBatailleComponent } from './journal-bataille.component';
import { StatutCacheComponent } from './statut-cache.component';
import {
  BOUTON_AVERTISSEMENT, BOUTON_DANGER, BOUTON_DESACTIVE, BOUTON_GRIS, BOUTON_PRIMAIRE, PASTILLE, PASTILLE_ACTIVE, PASTILLE_INACTIVE,
  PASTILLE_PRIMAIRE_ACTIVE,
} from './styles-analyse';

/**
 * L'outil « Isochrones routiers (ORS) » — portage de `filter-panel/IsochronesTool.tsx` (lot 4, T17) : durées, statut
 * du cache, LANCER / RECALCULER, progression ORS, journal, « Masquer les isochrones », « Voronoï » (le palier 0
 * résiduel), puis « X BATAILLE (ST_Difference) ».
 *
 * Il LIT l'état (`BatailleV1Service`, `BatailleService`) et ÉMET chaque lancement : c'est le panneau Analyse qui garde
 * le périmètre avant d'appeler le service (verrou `tests/unit/angular/panneau-analyse-garde.test.ts`). Les gestes sans
 * calcul (durées, masquer, « Voronoï ») agissent directement.
 */
@Component({
  selector: 'mg-outil-isochrones',
  imports: [JournalBatailleComponent, StatutCacheComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-hidden rounded-[4px] border-fin', '[class.border-default]': 'ouvert()', '[class.border-subtle]': '!ouvert()' },
  template: `
    <button type="button" data-entete-outil [disabled]="v1.chargement()" [attr.aria-expanded]="ouvert()" (click)="basculer.emit()"
      class="flex w-full cursor-pointer items-center justify-between border-0 px-3 py-[9px]"
      [class]="ouvert() ? 'bg-elevated' : 'bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)]'">
      <span class="text-[12px] font-medium" [class]="bataille.visible() ? 'text-primary' : 'text-secondary'">{{ bataille.visible() ? '✓ ' : '' }}Isochrones routiers (ORS)</span>
      <span class="text-[10px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
    </button>
    @if (ouvert()) {
      <div data-corps-outil class="flex flex-col gap-[13px] border-t-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_1%,transparent)] p-[13px]">
        <div>
          <div class="mb-1.5 text-[11px] font-medium text-secondary">Temps de trajet@if (v1.durees().length > 0) {<span class="text-secondary"> — {{ v1.durees().join(', ') }} min</span>}</div>
          <div class="flex flex-wrap gap-[5px]">
            @for (d of durees; track d) {
              <button type="button" data-duree [attr.aria-pressed]="v1.durees().includes(d)" (click)="v1.basculerDuree(d)"
                [class]="pastille + ' ' + (v1.durees().includes(d) ? pastillePrimaire : pastilleInactive)">{{ d }} min</button>
            }
          </div>
          <div class="mt-[5px] text-[11px] italic text-tertiary">Anneaux concentriques — calculé via ORS directement, sans IA</div>
        </div>

        @if (v1.cache(); as s) {
          <mg-statut-cache [statut]="s" variante="v1" />
        }

        <div class="flex gap-1.5">
          <button type="button" data-verifier-cache [disabled]="verifInactive()" (click)="verifierCache.emit()"
            [class]="bouton + ' ' + (verifInactive() ? desactive : gris)">{{ v1.verification() ? 'VÉRIF...' : 'VÉRIFIER CACHE' }}</button>
          <button type="button" data-lancer [disabled]="lancerInactif()" (click)="lancer.emit(false)"
            [class]="bouton + ' ' + (lancerInactif() ? desactive : danger)">{{ v1.chargement() ? 'CALCUL ORS...' : 'LANCER' }}</button>
          <button type="button" data-recalculer [disabled]="lancerInactif()" (click)="lancer.emit(true)"
            [class]="bouton + ' ' + (lancerInactif() ? desactive : avertissement)">RECALCULER</button>
        </div>

        @if (v1.journal().length > 0) {
          <div class="flex flex-col gap-1">
            @if (v1.chargement() && v1.total() > 0) {
              <div data-progression class="flex flex-col gap-[3px]">
                <div class="flex justify-between text-[11px] text-tertiary">
                  <span [class]="v1.progression() === 100 ? 'text-success' : 'text-warning'">{{ v1.progression() === 100 ? '✓ Terminé' : 'ORS — ' + v1.termines() + '/' + v1.total() + ' POIs' }}</span>
                  <span [class]="v1.progression() > 0 ? 'text-success' : 'text-tertiary'">{{ v1.progression() }}%</span>
                </div>
                <div class="h-1 overflow-hidden rounded-[2px] bg-elevated">
                  <div class="h-full rounded-[2px] transition-[width] duration-[400ms] ease-linear" [class]="v1.progression() === 100 ? 'bg-success' : 'bg-secondary'" [style.width.%]="v1.progression()"></div>
                </div>
              </div>
            }
            <mg-journal-bataille [journal]="v1.journal()" variante="v1" [enCours]="v1.chargement()" />
          </div>
        }

        @if (bataille.visible()) {
          <div class="flex gap-1.5">
            <button type="button" data-masquer (click)="masquer()" [class]="pastille + ' ' + pastilleInactive">Masquer les isochrones</button>
            <button type="button" data-contour title="Afficher/masquer le remplissage Voronoï résiduel (zones hors portée)"
              [attr.aria-pressed]="bataille.contourVisible()" (click)="bataille.contourVisible.set(!bataille.contourVisible())"
              [class]="pastille + ' ' + (bataille.contourVisible() ? pastilleActive : pastilleInactive)">{{ bataille.contourVisible() ? 'Voronoï ✓' : 'Voronoï' }}</button>
          </div>
        }

        @if (v1.anneauxDecoupe().length > 0 && !v1.chargement()) {
          <button type="button" data-appliquer [disabled]="v1.application()" (click)="appliquer.emit()"
            [class]="pastille + ' ' + pastilleInactive" [style.opacity]="v1.application() ? 0.5 : 1">{{ v1.application() ? 'BATAILLE… ' + v1.applicationPct() + '%' : 'X BATAILLE (ST_Difference)' }}</button>
          @if (v1.application()) {
            <div class="h-[3px] overflow-hidden rounded-[2px] bg-subtle">
              <div class="h-full transition-[width,background-color] duration-[400ms] ease-linear" [class]="v1.applicationPct() === 100 ? 'bg-success' : 'bg-secondary'" [style.width.%]="v1.applicationPct()"></div>
            </div>
          }
        }
      </div>
    }
  `,
})
export class OutilIsochronesComponent {
  readonly ouvert = input.required<boolean>();
  readonly basculer = output<void>();
  readonly verifierCache = output<void>();
  /** `true` : RECALCULER (`force_recalculate`). */
  readonly lancer = output<boolean>();
  readonly appliquer = output<void>();

  protected readonly v1 = inject(BatailleV1Service);
  protected readonly bataille = inject(BatailleService);
  protected readonly durees = ISO_DURATIONS;
  protected readonly pastille = PASTILLE;
  protected readonly pastillePrimaire = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleActive = PASTILLE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly bouton = BOUTON_PRIMAIRE;
  protected readonly desactive = BOUTON_DESACTIVE;
  protected readonly gris = BOUTON_GRIS;
  protected readonly danger = BOUTON_DANGER;
  protected readonly avertissement = BOUTON_AVERTISSEMENT;

  protected readonly lancerInactif = computed(() => this.v1.durees().length === 0 || this.v1.chargement());
  protected readonly verifInactive = computed(() => this.lancerInactif() || this.v1.verification());

  /** « Masquer les isochrones » : la bataille se cache, le journal se vide (`IsochronesTool.tsx:293`). */
  protected masquer(): void {
    this.bataille.visible.set(false);
    this.v1.viderJournal();
  }
}
