import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { formaterDecimal, formaterNombre, formaterNombreCourt } from '../../../../core/format/nombre';
import { SimulationService } from '../../etat/simulation.service';
import { RAMPE_CSS, trancheIndice } from '../../logique/palette-divergente';
import type { LigneZone } from '../../logique/simulation/vue';

/** Au-delà, on replie : 580 bassins nationaux ne se lisent pas d'un coup (`TableauZonesCampagne.tsx:20`). */
export const LIGNES_VISIBLES = 40;

/** Les en-têtes, MOT POUR MOT de `TableauZonesCampagne.tsx:46-47`. */
export const COLONNES_ZONES = [
  'Zone', 'Exposés', 'Part du plan', 'Part diffusée', 'Indice', 'Impr. utiles', 'Taux d’utile', 'Coût / exposé touché',
] as const;

/**
 * L'écart en POINTS DE PART, et non l'indice : un bassin de 0,1 % du plan à l'indice 10 pèse moins, en budget comme en
 * habitants, que la vallée de la chimie à l'indice 130. Trié par indice, le tableau ouvrait sur des micro-bassins.
 */
export const ecartZone = (z: LigneZone): number => Math.abs(z.part_diffusee - z.part_plan);

/** Les zones à lister : celles qui ont un plan, de l'écart le plus fort au plus faible (`TableauZonesCampagne.tsx:34-37`). */
export function zonesTriees(zones: readonly LigneZone[]): LigneZone[] {
  return zones.filter((z) => z.part_plan > 0).sort((a, b) => ecartZone(b) - ecartZone(a));
}

interface LigneAffichee {
  id: string;
  nom: string;
  actif: boolean;
  exposes: string;
  partPlan: string;
  partDiffusee: string;
  /** Le jeton de la tranche, ou celui d'une donnée absente — jamais la tranche « conforme » sans indice. */
  pastille: string;
  indice: string;
  sens: string;
  utiles: string;
  tauxUtile: string;
  cout: string;
}

/**
 * Le tableau des zones de l'étape ⑤, TRIÉ PAR ÉCART au plan — portage de `TableauZonesCampagne.tsx` (lot 3, T17).
 *
 * L'ordre répond à la question du media planner : « où la campagne s'écarte-t-elle le plus de ce qu'on a décidé ? »,
 * mesurée en points de part du plan — là où se déplacent des budgets. Un clic sélectionne la zone (la carte se recadre
 * et la souligne) ; un second clic la désélectionne. Aucune requête : tout vient de `SimulationService.vue`.
 *
 * La pastille d'indice est À CÔTÉ du chiffre, jamais sous lui : les tranches extrêmes sont foncées dans un thème et
 * claires dans l'autre, et aucun jeton de texte ne se lit sur les deux. Elle suit le thème (jetons `--diverge-*`) :
 * c'est du DOM, pas la carte.
 */
@Component({
  selector: 'mg-tableau-zones-campagne',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block max-h-[38%] shrink-0 overflow-auto border-t border-subtle' },
  template: `
    @if (vue()) {
      <table class="w-full border-collapse text-[11px]">
        <thead>
          <tr class="sticky top-0 z-[1] bg-[var(--bg-level-2)]">
            @for (c of colonnes; track c; let premiere = $first) {
              <th class="border-b-fin border-default px-2.5 py-[7px] font-normal whitespace-nowrap text-tertiary"
                  [class.text-left]="premiere" [class.text-right]="!premiere">{{ c }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (z of affichees(); track z.id) {
            <tr (click)="choisir(z.id, z.actif)" class="cursor-pointer" [style.background]="z.actif ? 'var(--bg-level-2)' : null">
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-left whitespace-nowrap text-primary">{{ z.nom }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.exposes }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.partPlan }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.partDiffusee }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">
                <span aria-hidden="true" data-pastille class="mr-1.5 inline-block size-[9px] rounded-[2px] align-[-1px]" [style.background]="z.pastille"></span>
                <span class="font-mono">{{ z.indice }}</span>
                <span class="ml-1.5 font-sans text-[10px] text-tertiary">{{ z.sens }}</span>
              </td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.utiles }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.tauxUtile }}</td>
              <td class="border-b-fin border-subtle px-2.5 py-1.5 text-right font-mono whitespace-nowrap text-primary">{{ z.cout }}</td>
            </tr>
          }
        </tbody>
      </table>
      @if (nTotal() > lignesVisibles) {
        <button type="button" (click)="tout.set(!tout())"
                class="mx-2.5 my-2 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-teal">{{ libelleTout() }}</button>
      }
    }
  `,
})
export class TableauZonesCampagneComponent {
  private readonly simulation = inject(SimulationService);

  protected readonly colonnes = COLONNES_ZONES;
  protected readonly lignesVisibles = LIGNES_VISIBLES;
  protected readonly vue = this.simulation.vue;
  protected readonly tout = signal(false);

  private readonly lignes = computed(() => zonesTriees(this.vue()?.zones ?? []));
  protected readonly nTotal = computed(() => this.lignes().length);
  protected readonly libelleTout = computed(() => (this.tout() ? 'Replier' : `Afficher les ${formaterNombre(this.nTotal())} zones`));

  protected readonly affichees = computed<LigneAffichee[]>(() => {
    const active = this.simulation.zoneActive();
    const lignes = this.tout() ? this.lignes() : this.lignes().slice(0, LIGNES_VISIBLES);
    return lignes.map((z) => {
      const t = trancheIndice(z.indice);
      return {
        id: z.id,
        nom: z.nom,
        actif: active === z.id,
        exposes: formaterNombre(z.pop_exposee),
        partPlan: `${formaterDecimal(z.part_plan * 100, 1)} %`,
        partDiffusee: `${formaterDecimal(z.part_diffusee * 100, 1)} %`,
        pastille: t < 0 ? 'var(--bg-level-3)' : RAMPE_CSS[t],
        indice: z.indice == null ? '—' : String(Math.round(z.indice)),
        sens: z.indice == null ? '' : z.indice < 90 ? 'sous' : z.indice > 110 ? 'sur' : '',
        utiles: formaterNombreCourt(Math.round(z.utiles)),
        tauxUtile: z.taux_utile == null ? '—' : `${formaterDecimal(z.taux_utile * 100, 1)} %`,
        cout: z.cout_expose_touche == null ? '—' : `${formaterDecimal(z.cout_expose_touche, 3)} €`,
      };
    });
  });

  protected choisir(id: string, actif: boolean): void {
    this.simulation.zoneActive.set(actif ? null : id);
  }
}
