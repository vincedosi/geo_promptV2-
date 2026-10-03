import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ThemeService } from '../core/theme/theme.service';
import { IconeComponent } from '../ui/icone/icone.component';

/**
 * `components/ThemeToggle.tsx` porté : 30 × 30, bord 0,5 transparent, soleil
 * (thème sombre) ou lune (thème clair) 15 px trait 1,5 ; survol level-2, bord
 * `--border-default`, texte primaire ; pression à 0,92.
 * La bascule passe par `ThemeService.basculer()`, et par lui seul : c'est lui
 * qui tient la règle `ECRIRE_HTML` (dans un hôte, `<html>` n'est jamais écrit).
 * Écart voulu : l'échange d'icône de React passe par un flou (`blur(2px)`),
 * interdit par « flat total » (DESIGN_SYSTEM § 2) — on garde rotation et fondu.
 */
@Component({
  selector: 'mg-bascule-theme',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      (click)="basculer()"
      [attr.title]="'Passer en ' + (suivant() === 'dark' ? 'mode sombre' : 'mode clair')"
      [attr.aria-label]="'Basculer le thème (actuel : ' + theme.theme() + ')'"
      class="inline-flex size-[30px] cursor-pointer items-center justify-center rounded-[6px] border-fin border-transparent bg-transparent p-0 text-secondary transition-[background-color,border-color,color,scale] duration-150 ease-[var(--ease-hover)] hover:border-default hover:bg-elevated hover:text-primary active:scale-[0.92]"
    >
      <span
        class="inline-flex size-[15px] transition-[opacity,rotate,scale] duration-[220ms] ease-[var(--ease-out)]"
        [class]="echange() ? 'opacity-55 -rotate-[18deg] scale-90' : 'opacity-100 rotate-0 scale-100'"
      >
        <mg-icone [nom]="theme.theme() === 'dark' ? 'soleil' : 'lune'" [taille]="15" [trait]="1.5" />
      </span>
    </button>
  `,
})
export class BasculeThemeComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly suivant = computed(() => (this.theme.theme() === 'dark' ? 'light' : 'dark'));
  /** Bref drapeau d'échange (240 ms, comme React) : l'icône tourne et pâlit le temps de la bascule. */
  protected readonly echange = signal(false);
  private minuterie: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.minuterie));
  }

  protected basculer(): void {
    this.echange.set(true);
    this.theme.basculer();
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.echange.set(false), 240);
  }
}
