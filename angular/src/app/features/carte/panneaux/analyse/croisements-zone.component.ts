import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { BOUTON_CALCUL, ENCART_ERREUR } from './styles-analyse';

/**
 * ④ Analyse — « Dans cette zone » (lot 4, T13), sous la couverture : les émetteurs radio dont le cercle touche la zone
 * et les comptages routiers qui la traversent (`croisements_zone`, sql/273). Sans équivalent React.
 *
 * Lu par son propre bouton, jamais à l'ouverture (quota partagé avec le chiffrage). La lecture et son résultat vivent
 * dans `ZoneAnalyseeService` (P-e) : ils survivent au repli de l'accordéon et à ④ → ① → ④, et s'effacent quand la
 * zone change (P-c). Le composant n'est qu'un gabarit.
 */
@Component({
  selector: 'mg-croisements-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 border-t border-subtle pt-3', 'data-croisements': '' },
  template: `
    <div class="text-[12px] font-medium text-primary">Dans cette zone</div>
    <div class="text-[11px] leading-[1.5] text-tertiary">Émetteurs radio dont la couverture touche la zone, comptages routiers qui la traversent.</div>

    @if (etat.erreur(); as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }
    <button type="button" data-lire-croisements [disabled]="etat.enCours()" (click)="z.lireCroisements()" [class]="boutonCalcul">
      {{ etat.enCours() ? 'Lecture…' : 'Voir la radio et le trafic' }}
    </button>

    @if (etat.resultat(); as r) {
      <details data-radio class="text-[11px]">
        <summary class="cursor-pointer text-secondary">
          <span class="font-mono text-primary">{{ nombre(r.radio.n_emetteurs) }}</span> émetteur{{ r.radio.n_emetteurs > 1 ? 's' : '' }} radio
        </summary>
        <ul class="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
          @for (e of r.radio.emetteurs; track e.site) {
            <li data-emetteur class="text-tertiary">
              <span class="font-mono text-secondary">{{ e.site }}</span>
              @if (e.lieu) { · {{ e.lieu }} }
              <!-- Jusqu'à 106 stations par site : une ligne, la liste entière au survol. -->
              @if (e.stations.length) {
                @let noms = e.stations.join(', ');
                <span class="block truncate text-secondary" [title]="noms">{{ noms }}</span>
              }
            </li>
          }
          @if (r.radio.tronque) { <li data-autres class="text-tertiary">… et {{ nombre(r.radio.n_emetteurs - r.radio.emetteurs.length) }} autres</li> }
        </ul>
        @if (r.radio.n_sans_rayon > 0) {
          <div class="mt-1 text-tertiary"><span class="font-mono">{{ nombre(r.radio.n_sans_rayon) }}</span> émetteur{{ r.radio.n_sans_rayon > 1 ? 's' : '' }} sans rayon de couverture, non compté{{ r.radio.n_sans_rayon > 1 ? 's' : '' }}.</div>
        }
      </details>

      <details data-trafic class="text-[11px]">
        <summary class="cursor-pointer text-secondary">
          <span class="font-mono text-primary">{{ nombre(r.trafic.n_comptages) }}</span> comptage{{ r.trafic.n_comptages > 1 ? 's' : '' }} routier{{ r.trafic.n_comptages > 1 ? 's' : '' }}
          @if (r.trafic.tmja_max !== null) {
            · TMJA max <span class="font-mono">{{ nombre(r.trafic.tmja_max) }}</span>, médian <span class="font-mono">{{ nombre(r.trafic.tmja_median) }}</span>
          }
        </summary>
        <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          @for (c of r.trafic.comptages; track $index) {
            <li data-comptage class="flex gap-2 text-tertiary">
              <span class="flex-1 font-mono text-secondary">{{ c.route }}</span>
              <span class="font-mono text-primary">{{ nombre(c.tmja) }}</span> véh./jour
              <span class="font-mono">{{ c.annee_mesure }}</span>
            </li>
          }
          @if (r.trafic.tronque) { <li data-autres class="text-tertiary">… et {{ nombre(r.trafic.n_comptages - r.trafic.comptages.length) }} autres</li> }
        </ul>
      </details>
    }
  `,
})
export class CroisementsZoneComponent {
  protected readonly z = inject(ZoneAnalyseeService);
  protected readonly etat = this.z.croisements;
  protected readonly nombre = formaterNombre;
  protected readonly boutonCalcul = BOUTON_CALCUL;
  protected readonly encartErreur = ENCART_ERREUR;
}
