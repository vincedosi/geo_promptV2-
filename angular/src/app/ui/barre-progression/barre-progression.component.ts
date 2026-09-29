import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChargementService } from '../../core/chargement/chargement.service';

/**
 * UNE barre pour tout l'écran, lue dans le ChargementService fourni par
 * l'écran. TOUJOURS montée, seule l'opacité change : la démonter relancerait
 * l'animation et ferait sauter la mise en page à chaque calcul.
 *
 * ⚠ L'écran qui la monte DOIT déclarer `providers: [ChargementService]`
 * (`@Injectable()` sans `providedIn: 'root'`, voir chargement.service.ts) —
 * sans quoi l'injection remonte à la racine et lève un `NullInjectorError`.
 * Et les clés de piste passées à `ChargementService.suivre(cle, …)` doivent
 * être UNIQUES par écran : deux pistes qui partagent une clé s'écrasent
 * l'une l'autre dans le même service.
 */
@Component({
  selector: 'mg-barre-progression',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="progressbar"
         [attr.aria-busy]="etat().actif"
         [attr.aria-label]="etat().texte ?? 'Aucun calcul en cours'"
         class="relative h-[3px] overflow-hidden transition-opacity duration-150"
         [class.bg-overlay]="etat().actif"
         [class.opacity-0]="!etat().actif">
      @if (etat().actif) {
        <span class="curseur" aria-hidden="true"></span>
        <span class="absolute top-1.5 left-5 whitespace-nowrap pointer-events-none text-[10.5px] text-tertiary">
          {{ etat().texte }}
        </span>
      }
    </div>
  `,
  styles: `
    .curseur {
      position: absolute; top: 0; left: 0; height: 100%; width: 25%;
      background: var(--brand-teal);
      animation: glisse 1.1s ease-in-out infinite;
    }
    @keyframes glisse {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .curseur { animation: none; width: 100%; opacity: 0.45; }
    }
  `,
})
export class BarreProgressionComponent {
  protected readonly etat = computed(() => this.chargement.etat());
  private readonly chargement = inject(ChargementService);
}
