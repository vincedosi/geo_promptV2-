import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CelluleLigne, CelluleTotal } from '../../logique/zones/plan-media';

/** Classes d'une cellule d'en-tête (`thStyle`, `ZoneMediaPlanPanel.tsx:402-406`). */
const TH = 'whitespace-nowrap border-b-fin border-default px-2 py-1.5 text-right text-[10px] font-medium text-tertiary';
/** Classes d'une cellule chiffrée (`tdStyle`, `:407-411`) ; la couleur est posée par cellule. */
const TD = 'whitespace-nowrap border-b-fin border-subtle p-2 text-right font-mono text-[11.5px] tabular-nums';
/** Le pied : mêmes cellules, sans trait du bas. */
const TD_PIED = 'whitespace-nowrap p-2 text-right font-mono text-[11.5px] tabular-nums';

/**
 * Le tableau du plan média — `ZoneMediaPlanPanel.tsx:523-593` : une ligne par item ou par zone, le pied « Total », et
 * la répartition modifiable (somme ramenée à 100 par le panneau). Il ne calcule RIEN : il reçoit des cellules déjà
 * formatées (`cellulesPlan`, `celluleTotal`) et rend la part saisie au panneau.
 */
@Component({
  selector: 'mg-tableau-plan-media',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block overflow-x-auto' },
  template: `
    <table class="w-full border-collapse">
      <thead>
        <tr>
          <th [class]="th" class="!text-left">Zone</th>
          <th [class]="th" title="Part de la ligne dans le total affiché, sur la cible">% total</th>
          <th [class]="th" title="Volume cible de la zone rapporté à la population France de la cible">% France</th>
          <th [class]="th" [attr.title]="'Volume cible (' + unite() + ')'">Volume</th>
          <th [class]="th" title="Répartition % × impressions totales — calculé">Impressions</th>
          <th [class]="th" title="Répétition : impressions ÷ audience cible (nombre de vues par personne)">Répétition</th>
          <th [class]="th" title="Coût pour 1000 personnes de la cible : budget de la zone ÷ (audience ÷ 1000)">€/1000</th>
          <th [class]="th" title="Part du budget allouée à la zone — modifiable, somme = 100 %">Répart.</th>
        </tr>
      </thead>
      <tbody>
        @for (c of cellules(); track c.id) {
          <tr [attr.data-ligne]="c.id">
            <td [class]="td" class="max-w-[120px] overflow-hidden text-ellipsis !text-left !font-sans !text-[12px] text-primary" [attr.title]="c.nom">{{ c.nom }}</td>
            <td [class]="td" class="text-secondary">{{ c.pctZones }}</td>
            <td [class]="td" class="text-secondary">{{ c.pctFrance }}</td>
            <td [class]="td" class="text-secondary" [attr.title]="c.volumeAbsent ? 'Stats d’audience non calculées pour cette zone' : null">{{ c.volume }}</td>
            <td [class]="td" class="text-tertiary">{{ c.impressions }}</td>
            <td
              [class]="td"
              [class.text-warning]="c.surExposition"
              [class.text-secondary]="!c.surExposition"
              [attr.title]="c.surExposition ? 'Sur-exposition : le budget dépasse largement l’audience cible' : null"
            >{{ c.repetition }}</td>
            <td [class]="td" class="text-secondary">{{ c.cout }}</td>
            <td [class]="td" class="!py-1 !pl-2 !pr-0">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                [value]="c.part"
                [attr.aria-label]="'Répartition ' + c.nom"
                class="w-[58px] rounded-[4px] border-fin bg-elevated px-1.5 py-[5px] text-right font-mono text-[11.5px] text-primary outline-none"
                [class.border-teal]="saisie()"
                [class.border-default]="!saisie()"
                (input)="part.emit({ id: c.id, valeur: $any($event.target).value })"
              />
            </td>
          </tr>
        }
      </tbody>
      @if (total(); as t) {
        <tfoot>
          <tr data-total>
            <td [class]="pied" class="!text-left !font-sans text-tertiary">Total</td>
            <td [class]="pied" class="text-secondary">{{ t.pctZones }}</td>
            <td [class]="pied" class="text-secondary">{{ t.pctFrance }}</td>
            <td [class]="pied" class="text-primary">{{ t.volume }}</td>
            <td [class]="pied" class="text-primary">{{ t.impressions }}</td>
            <td [class]="pied" class="text-secondary">{{ t.repetition }}</td>
            <td [class]="pied" class="text-secondary">{{ t.cout }}</td>
            <td [class]="pied" class="text-secondary">{{ t.repartition }}</td>
          </tr>
        </tfoot>
      }
    </table>
  `,
})
export class TableauPlanMediaComponent {
  readonly cellules = input.required<readonly CelluleLigne[]>();
  readonly total = input.required<CelluleTotal>();
  /** L'unité de la cible (« hab. », « ménages », « logements ») pour l'infobulle de « Volume ». */
  readonly unite = input.required<string>();
  /** Une répartition a été saisie : les champs se bordent de teal (`repartition ? brand-teal : border-default`). */
  readonly saisie = input(false);
  /** La part tapée dans une ligne, texte brut du champ (le panneau la lit comme React : `parseFloat(…) || 0`). */
  readonly part = output<{ id: string; valeur: string }>();

  protected readonly th = TH;
  protected readonly td = TD;
  protected readonly pied = TD_PIED;
}
