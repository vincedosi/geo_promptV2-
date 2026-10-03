import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IconeComponent } from '../ui/icone/icone.component';
import { BarreLateraleComponent } from './barre-laterale.component';
import { ChromeHautComponent } from './chrome-haut.component';
import { ecouterFermeture } from './fermeture';

/** Ce qui peut recevoir le focus dans le tiroir (piège de Tab). */
const FOCUSABLES = 'a[href], button:not([disabled]), [tabindex="0"]';

/**
 * La coquille des pages MAGELIAN : `components/AppSidebar.tsx` +
 * `components/layout/TopRightChrome.tsx` + `components/layout/MainPadding.tsx`.
 *
 * - Grand écran (≥ 768 px) : barre de 240 px à gauche, dans le flux (React la
 *   pose en `fixed` : interdit ici, un élément fixe se positionnerait sur la
 *   fenêtre de l'HÔTE). Le contenu défile dans un conteneur dont la
 *   première ligne, collante et de hauteur nulle, porte le chrome haut-droite :
 *   il reste en place pendant le défilement et s'arrête avant la barre de
 *   défilement, comme le `fixed` de React.
 * - Petit écran : bouton Menu en haut à gauche, qui ouvre la barre dans un
 *   TIROIR (la `Sheet` Radix de React) rendu DANS l'arbre : voile, Échap, clic
 *   extérieur, bouton Fermer, piège de Tab, focus rendu au bouton Menu.
 *   Écart voulu : suivre un lien ferme le tiroir (la Sheet de React restait
 *   ouverte par-dessus la nouvelle page).
 * - Contenu : `p-8`, comme `MainPadding`.
 * ⚠ Liens RELATIFS, résolus contre la route de la coquille (contrat AIDA).
 */
@Component({
  selector: 'mg-coquille',
  imports: [RouterOutlet, BarreLateraleComponent, ChromeHautComponent, IconeComponent],
  templateUrl: './coquille.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes voile-entree { from { opacity: 0; } to { opacity: 1; } }
    @keyframes tiroir-entree { from { transform: translateX(-100%); } to { transform: translateX(0); } }
    .voile { animation: voile-entree 500ms ease-in-out; }
    .tiroir { animation: tiroir-entree 500ms ease-in-out; }
  `,
})
export class CoquilleComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly injecteur = inject(Injector);
  private readonly declencheur = viewChild.required<ElementRef<HTMLButtonElement>>('declencheur');
  private readonly tiroir = viewChild<ElementRef<HTMLElement>>('tiroir');

  protected readonly tiroirOuvert = signal(false);
  /** Changer de génération détruit et recrée l'outlet, donc la page courante (et ses appels). */
  protected readonly generation = signal(0);

  private retirerEcoute: (() => void) | null = null;

  constructor() {
    effect(() => {
      const ouvert = this.tiroirOuvert();
      untracked(() => {
        this.retirerEcoute?.();
        this.retirerEcoute = null;
        if (!ouvert) return;
        this.retirerEcoute = ecouterFermeture(this.doc, () => [this.tiroir()?.nativeElement], () => this.fermerTiroir(true));
      });
    });
    inject(DestroyRef).onDestroy(() => this.retirerEcoute?.());
  }

  /**
   * Équivalent du `window.location.reload()` de React après un changement
   * d'organisation : la page courante est recréée (ses données relues avec la
   * nouvelle organisation), sans recharger le shell ni toucher à l'URL.
   */
  protected actualiser(): void {
    this.generation.update((g) => g + 1);
  }

  protected ouvrirTiroir(): void {
    this.tiroirOuvert.set(true);
    afterNextRender(() => this.tiroir()?.nativeElement.querySelector<HTMLElement>(FOCUSABLES)?.focus(), {
      injector: this.injecteur,
    });
  }

  /** @param rendreFocus vrai sauf après un lien suivi (le focus appartient alors à la nouvelle page). */
  protected fermerTiroir(rendreFocus: boolean): void {
    if (!this.tiroirOuvert()) return;
    this.tiroirOuvert.set(false);
    if (rendreFocus) this.declencheur().nativeElement.focus();
  }

  /** Tab et Maj+Tab bouclent dans le tiroir, comme le piège de focus de la Sheet Radix. */
  protected pieger(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const el = this.tiroir()?.nativeElement;
    if (!el) return;
    const liste = [...el.querySelectorAll<HTMLElement>(FOCUSABLES)];
    if (liste.length === 0) return;
    const actif = (el.getRootNode() as Document | ShadowRoot).activeElement;
    const premier = liste[0];
    const dernier = liste[liste.length - 1];
    if (!e.shiftKey && actif === dernier) {
      e.preventDefault();
      premier.focus();
    } else if (e.shiftKey && actif === premier) {
      e.preventDefault();
      dernier.focus();
    }
  }
}
