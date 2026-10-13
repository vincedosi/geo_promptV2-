import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { CaptureService } from '../../etat/capture.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
import { CreerRayonComponent } from './creer-rayon.component';

/**
 * Le panneau de l'étape ③ Zones — `app/map/_components/panneaux/PanneauZones.tsx` (lot 4, T14-T16) : « Ce que je
 * fabrique ». Créer une zone, puis le renvoi vers l'outil Mes zones (2026-10-13) :
 *
 *   - « Créer une zone » (T16) : la capture des couches actives (`mg-capture`, badge = nombre de couches
 *     contributives allumées, déclarées par leurs services au `CaptureService`), puis les codes postaux, le rayon et
 *     le dessin. Chaque création relit « Mes zones » (`OutilsCarteService.zonesModifiees`) — la capture aussi, ce que
 *     React ne faisait pas.
 *   - Le renvoi : les jeux de zones et « Mes zones » vivent dans la boîte à outils (`outils/outil-mes-zones`, spec § 6) ;
 *     un bouton l'ouvre sans changer d'étape.
 *
 * `CreationZoneService` est fourni ICI : l'organisation active est relue à chaque ouverture du panneau.
 */
@Component({
  selector: 'mg-panneau-zones',
  imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent, IconeComponent],
  providers: [CreationZoneService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-y-auto' },
  template: `
    <section data-section="creer" class="border-b-fin border-subtle px-4 py-3">
      <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Créer une zone</h4>
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

      <mg-creer-codes-postaux (cree)="relire()" />
      <mg-creer-rayon (cree)="relire()" />
      <mg-creer-dessin (cree)="relire()" />
    </section>
    @if (captureOuverte()) {
      <mg-capture (fermer)="captureOuverte.set(false)" (cree)="relire()" />
    }

    <section data-section="vers-mes-zones" class="px-4 py-3">
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
  `,
})
export class PanneauZonesComponent {
  protected readonly compte = inject(CaptureService).compte;
  protected readonly captureInactive = computed(() => this.compte() === 0);
  protected readonly captureOuverte = signal(false);
  protected readonly outils = inject(OutilsCarteService);

  /** Une zone créée : « Mes zones », dans la boîte à outils, se relit sans être recréé (sa sélection survit). */
  protected relire(): void {
    this.outils.zonesModifiees();
  }
}
