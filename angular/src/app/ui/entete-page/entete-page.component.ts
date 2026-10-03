import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Titre de page : h1 Inter 500 18 px, interlettrage −0,02 em (DESIGN_SYSTEM § 4),
 * puis sous-titre 13 px tertiaire — le bloc d'en-tête de `app/dashboard/page.tsx:104-114`.
 */
@Component({
  selector: 'mg-entete-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="m-0 mb-1 text-[18px] font-medium tracking-[-0.02em] text-primary">{{ titre() }}</h1>
    @if (sousTitre()) {
      <p class="m-0 text-[13px] text-tertiary">{{ sousTitre() }}</p>
    }
  `,
  host: { class: 'block mb-8' },
})
export class EntetePageComponent {
  readonly titre = input.required<string>();
  readonly sousTitre = input<string>();
}
