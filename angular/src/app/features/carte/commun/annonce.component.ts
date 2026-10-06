import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { AnnonceService, DUREE_ANNONCE_MS } from '../etat/annonce.service';

/**
 * Les annonces de la carte (arbitrage B14) — rendu de la carte `info` de `components/ui/geo-toast.tsx` :
 * fond `--bg-surface`, bord 0,5 + liseré gauche de 3 px teal, icône Info, texte 13/500, croix, barre de
 * progression de 2 px qui se vide en 4 s.
 *
 * `absolute` en haut à droite de la PAGE carte (React : `position: fixed`, `top/right: 12`, `z-index`
 * 10 000) — jamais `fixed` ni un portail vers `body`, interdits dans la racine d'ombre. La région est
 * `role="status"` / `aria-live="polite"` : la phrase est lue sans voler le focus.
 */
@Component({
  selector: 'mg-annonce',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes arrivee {
      from { opacity: 0; transform: translateX(100%) scale(0.97); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes vidage { from { width: 100%; } to { width: 0%; } }
    .carte-annonce { animation: arrivee 320ms cubic-bezier(0.32, 0.72, 0, 1) both; }
    .barre { animation-name: vidage; animation-timing-function: linear; animation-fill-mode: both; }
  `,
  host: {
    class: 'pointer-events-none absolute right-3 top-3 z-[10000] flex flex-col gap-2',
    role: 'status',
    'aria-live': 'polite',
  },
  template: `
    @for (a of service.annonces(); track a.id) {
      <div
        data-annonce
        class="carte-annonce pointer-events-auto min-w-[280px] max-w-[380px] overflow-hidden rounded-[8px] border-fin border-l-[3px] border-default border-l-teal bg-surface"
      >
        <div class="flex items-start gap-2.5 px-4 py-3">
          <mg-icone nom="info" [taille]="16" [trait]="2" class="mt-px shrink-0 text-teal" />
          <div class="min-w-0 flex-1 text-[13px] font-medium text-primary">{{ a.texte }}</div>
          <button
            type="button"
            aria-label="Fermer l'annonce"
            (click)="service.retirer(a.id)"
            class="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-tertiary transition-colors duration-150 hover:text-primary"
          >
            <mg-icone nom="croix" [taille]="14" />
          </button>
        </div>
        <div class="h-[2px] bg-subtle">
          <div class="barre h-full bg-teal opacity-40" [style.animation-duration.ms]="duree"></div>
        </div>
      </div>
    }
  `,
})
export class AnnonceComponent {
  protected readonly service = inject(AnnonceService);
  protected readonly duree = DUREE_ANNONCE_MS;
}
