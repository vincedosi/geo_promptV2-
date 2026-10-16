import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  CONSIGNE_AUTRES, CONSIGNE_ETAPE, ETAPES_CARTE, LIBELLE_AUTRES, LIBELLE_ETAPE_CARTE, VUE_AUTRES, type VueParcours, rangEtapeCarte,
} from '../logique/parcours';

/** 'alt+1' -> 'Alt + 1' — `formaterRaccourci` de `HelpOverlay.tsx:7-12`. */
export function formaterRaccourci(raccourci: string): string {
  return raccourci.split('+').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
}

const RACCOURCIS = [
  ...ETAPES_CARTE.map((e) => ({ libelle: `${rangEtapeCarte(e)}. ${LIBELLE_ETAPE_CARTE[e]}`, touches: formaterRaccourci(`alt+${rangEtapeCarte(e)}`) })),
  { libelle: 'Fermer le tiroir, quitter le mode immersif', touches: 'Échap' },
];

/**
 * Le tiroir « Aide » de la boîte à outils (spec § 6) : l'aide de l'ÉTAPE COURANTE, puis les raccourcis du parcours,
 * DÉRIVÉS de `ETAPES_CARTE` (jamais recopiés). L'ancienne liste dérivait de la navigation du rail, retirée le
 * 2026-10-13 (réécrite à la tâche 4, qui supprime `logique/navigation.ts` ; montée dans le tiroir à la tâche 5).
 */
@Component({
  selector: 'mg-aide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4 px-4 py-3 font-sans' },
  template: `
    <section data-aide-etape>
      <h4 class="m-0 text-[12px] font-medium text-primary">{{ titre() }}</h4>
      <p class="mb-0 mt-1 text-[12px] leading-[1.5] text-secondary">{{ consigne() }}</p>
      <p class="mb-0 mt-1 text-[11px] leading-[1.5] text-tertiary">Le parcours n’est pas un tunnel : chaque étape reste ouverte, dans les deux sens.</p>
    </section>
    <section>
      <h4 class="mb-2 mt-0 text-[11px] font-medium text-secondary">Raccourcis clavier</h4>
      @for (r of raccourcis; track r.touches) {
        <div data-raccourci class="flex items-center justify-between border-b-fin border-subtle px-1.5 py-2">
          <span class="text-[12px] text-primary">{{ r.libelle }}</span>
          <span class="rounded-[4px] border-fin border-default bg-elevated px-2 py-0.5 font-mono text-[11px] text-secondary">{{ r.touches }}</span>
        </div>
      }
    </section>
  `,
})
export class AideComponent {
  /** L'étape courante, ou « Autres » (T11b) — hors parcours, sans numéro. */
  readonly etape = input.required<VueParcours>();
  protected readonly titre = computed(() => {
    const e = this.etape();
    return e === VUE_AUTRES ? `${LIBELLE_AUTRES}, hors parcours` : `${rangEtapeCarte(e)}. ${LIBELLE_ETAPE_CARTE[e]}`;
  });
  protected readonly consigne = computed(() => {
    const e = this.etape();
    return e === VUE_AUTRES ? CONSIGNE_AUTRES : CONSIGNE_ETAPE[e];
  });
  protected readonly raccourcis = RACCOURCIS;
}
