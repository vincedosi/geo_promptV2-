import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { IconeComponent } from '../icone/icone.component';
import type { NomIcone } from '../icone/icones';

/**
 * Carte de chiffre du tableau de bord (`app/dashboard/page.tsx:117-155`) : icône
 * teal 20 px, valeur mono 15/500, libellé 12 tertiaire. Nommée « tuile » pour ne
 * pas se confondre avec `mg-carte` (la carte MapLibre). Au survol le bord passe à
 * `--border-default` ; la tuile `cliquable` prend le curseur main (sinon `default`, comme
 * React) — elle ne navigue pas elle-même, le parent l'enveloppe. Pas de soulèvement :
 * celui de React est annulé par son animation d'entrée, le rendu n'en a pas.
 */
@Component({
  selector: 'mg-tuile-chiffre',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-icone [nom]="icone()" [taille]="20" [trait]="1.5" class="mb-3 block text-teal" />
    <div class="mb-1 truncate font-mono text-[15px] font-medium text-primary">{{ valeur() }}</div>
    <div class="truncate text-[12px] text-tertiary">{{ libelle() }}</div>
  `,
  host: {
    class:
      'block rounded-lg border-fin border-subtle bg-surface px-[18px] py-4 [transition:border-color_0.15s] hover:border-default',
    '[class]': "cliquable() ? 'cursor-pointer' : 'cursor-default'",
  },
})
export class TuileChiffreComponent {
  readonly icone = input.required<NomIcone>();
  readonly valeur = input.required<string>();
  readonly libelle = input.required<string>();
  readonly cliquable = input(false, { transform: booleanAttribute });
}
