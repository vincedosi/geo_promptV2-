import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { IconeComponent } from '../icone/icone.component';

/**
 * Bandeau de section : `.geo-section-header` de `app/globals.css:527-550`
 * (DESIGN_SYSTEM § 5). Fond de niveau 2, trait haut de 1 px (l'un des rares
 * séparateurs à 1 px), point teal de 6 px, libellé Inter 500 12 px.
 * Le bandeau ne pose pas ses coins : React les passe en ligne selon l'endroit
 * (`borderRadius: '6px 6px 0 0'`), ici `class="rounded-t-lg"` sur l'élément.
 * `repliable` ajoute le chevron (DESIGN_SYSTEM : 14 px, tertiaire, à droite) et
 * fait du bandeau un bouton ; `ouvert` est alors l'état, à lire par le parent.
 */
@Component({
  selector: 'mg-entete-section',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-teal"></span>
    <span class="text-[12px] font-medium text-primary">{{ libelle() }}</span>
    @if (repliable()) {
      <mg-icone [nom]="ouvert() ? 'chevron-haut' : 'chevron-bas'" [taille]="14" [trait]="1.5" class="ml-auto shrink-0 text-tertiary" />
    }
  `,
  host: {
    class: 'flex items-center gap-2 border-t border-subtle bg-elevated px-3.5 py-2.5',
    '[class.cursor-pointer]': 'repliable()',
    '[attr.role]': 'repliable() ? "button" : null',
    '[attr.tabindex]': 'repliable() ? 0 : null',
    '[attr.aria-expanded]': 'repliable() ? ouvert() : null',
    '(click)': 'basculer()',
    '(keydown.enter)': 'basculer()',
    '(keydown.space)': 'basculer(); $event.preventDefault()',
  },
})
export class EnteteSectionComponent {
  readonly libelle = input.required<string>();
  readonly repliable = input(false, { transform: booleanAttribute });
  readonly ouvert = model(true);

  protected basculer(): void {
    if (this.repliable()) this.ouvert.update((o) => !o);
  }
}
