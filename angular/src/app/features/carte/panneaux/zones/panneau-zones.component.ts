import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { CaptureService } from '../../etat/capture.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
import { CreerRayonComponent } from './creer-rayon.component';
import { JeuxDeZonesComponent } from './jeux-de-zones.component';
import { MesZonesComponent } from './mes-zones.component';

/**
 * Le panneau « Zones » du rail — `app/map/_components/panneaux/PanneauZones.tsx` (lot 4, T14-T16) : « Ce que je
 * fabrique ». Trois sections, dans l'ordre de React :
 *
 *   - « Créer une zone » (T16) : la capture des couches actives (`mg-capture`, badge = nombre de couches
 *     contributives allumées, déclarées par leurs services au `CaptureService`), puis les codes postaux, le rayon et
 *     le dessin. Chaque création relit « Mes zones » (`rafraichir`) — la capture aussi, ce que React ne faisait pas.
 *   - « Jeux de zones à risque » (T13, `mg-jeux-de-zones`) : AVANT « Mes zones », comme React — peu nombreux, ils
 *     portent un plan de campagne, là où « Mes zones » se parcourt en défilant.
 *   - « Mes zones » (`mg-mes-zones`).
 *
 * `CreationZoneService` est fourni ICI : l'organisation active est relue à chaque ouverture du panneau.
 */
@Component({
  selector: 'mg-panneau-zones',
  imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent, IconeComponent, JeuxDeZonesComponent, MesZonesComponent],
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

    <mg-jeux-de-zones />

    <section data-section="mes-zones" class="pt-3">
      <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium tracking-[0.04em] text-secondary">Mes zones</h4>
      <mg-mes-zones [rafraichir]="rafraichir()" />
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
  /** Incrémenté à chaque zone créée : « Mes zones » se relit sans être recréé (sa sélection survit). */
  protected readonly rafraichir = signal(0);

  protected relire(): void {
    this.rafraichir.update((n) => n + 1);
  }
}
