import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { StatsSources } from '../data/sources-admin.api';

/**
 * Onglet « Carreaux » des Sources — portage de `CarreauxPanel.tsx` (lot 6, T19) : fiche descriptive de
 * `carreaux_filosofi` et son volume. Purement présentationnel, aucune lecture (statistiques de l'écran).
 *
 * Gardé par parité : total en `toFixed(2) + 'M'` (C17), textes de React à l'identique.
 * Couleurs (C9) : `C.green` → `--success` ; `${C.green}44` (CSS invalide chez React, donc sans bord) →
 * `--success` à 27 % ; `#06b6d4` (ST_Intersects) → `--info`.
 */
@Component({
  selector: 'mg-sources-carreaux',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total(); as t) {
      <div class="colonne">
        <div class="bandeau">
          <div class="corps">
            <div class="bandeau-titre" data-titre>Carreaux INSEE Filosofi 200m</div>
            <div class="lignes" data-fiche>
              <span data-ligne><span class="cle">Source: </span>INSEE Filosofi</span><br />
              <span data-ligne><span class="cle">Résolution: </span>200m × 200m</span><br />
              <span data-ligne><span class="cle">Couverture: </span>France métropolitaine</span><br />
              <span data-ligne><span class="cle">Données: </span>population, revenus, âge, densité</span><br />
              <span data-ligne><span class="cle">Table: </span><span class="accent">carreaux_filosofi</span></span>
            </div>
          </div>
          <div class="droite">
            <div class="grand-total" data-total>{{ t }}</div>
            <div class="unite" data-unite>carreaux</div>
          </div>
        </div>
        <div class="utilisation" data-utilisation>
          <span class="commentaire">// utilisation</span>
          Jointure spatiale avec <span class="vert">public.iris</span> via <span class="cyan">ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
          Agrégation démographique par isochrone ou zone de chalandise.
        </div>
      </div>
    } @else if (chargement()) {
      <div class="message" data-chargement><mg-icone nom="chargement" [taille]="18" class="tourne" /> Chargement...</div>
    } @else {
      <div class="message" data-vide>Aucune donnée.</div>
    }
  `,
  styleUrl: './panneaux-commun.css',
  styles: `
    :host { --teinte: var(--success); --bord: 27%; }
    .vert { color: var(--success); }
    .cyan { color: var(--info); }
  `,
})
export class CarreauxComponent {
  readonly stats = input<StatsSources | null>(null);
  readonly chargement = input(false);

  protected readonly total = computed(() => {
    const s = this.stats();
    return s ? (s.carreaux.total / 1_000_000).toFixed(2) + 'M' : null;
  });
}
