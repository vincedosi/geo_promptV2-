import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { ENTREES_NAVIGATION } from '../logique/navigation';

/** 'ctrl+k' -> 'Ctrl + K', 'alt+1' -> 'Alt + 1' — `formaterRaccourci` de `HelpOverlay.tsx:7-12`. */
export function formaterRaccourci(raccourci: string): string {
  return raccourci
    .split('+')
    .map((partie) => partie.charAt(0).toUpperCase() + partie.slice(1))
    .join(' + ');
}

/**
 * Le panneau « Aide » du rail — portage de `components/map/overlays/HelpOverlay.tsx` : la liste des
 * raccourcis clavier, DÉRIVÉE de `ENTREES_NAVIGATION` (jamais recopiée à la main).
 *
 * Seul écart : l'Assistant n'y figure pas. Il n'est jamais porté (décision du propriétaire du 2026-10-04) :
 * le rail ne le rend pas et `Ctrl+K` n'est pas capté — l'annoncer ici documenterait un raccourci mort.
 * Campagne (`Alt+C`) reste listée : son entrée est rendue dans le rail, inerte (B6), comme ici.
 */
@Component({
  selector: 'mg-aide',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1 px-4 py-3 font-sans' },
  template: `
    <h4 class="mb-2 mt-0 text-[11px] font-medium tracking-[0.04em] text-secondary">Raccourcis clavier</h4>
    @for (entree of entrees; track entree.id) {
      <div data-raccourci class="flex items-center justify-between border-b-fin border-subtle px-1.5 py-2">
        <span class="flex items-center gap-2 text-[12px] text-primary">
          <mg-icone [nom]="entree.icone" [taille]="14" [trait]="1.5" />
          {{ entree.label }}
        </span>
        <span class="rounded-[4px] border-fin border-default bg-elevated px-2 py-0.5 font-mono text-[11px] text-secondary">{{ entree.touches }}</span>
      </div>
    }
  `,
})
export class AideComponent {
  protected readonly entrees = ENTREES_NAVIGATION
    .filter((e) => e.raccourci && e.id !== 'assistant')
    .map((e) => ({ id: e.id, label: e.label, icone: e.icone, touches: formaterRaccourci(e.raccourci as string) }));
}
