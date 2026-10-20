import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { StatsSources } from '../data/sources-admin.api';

/**
 * Onglet « OOH » des Sources — portage RÉDUIT de `OohPanel.tsx` (lot 6, T19, amendement A6) : le
 * bandeau « Data Lake OOH — panneaux_affichage » et le nombre de panneaux actifs, `ooh.total`, et rien
 * d'autre. `get_sources_stats` ne rend plus que `total` depuis sql/082 : React affiche des champs vides
 * (« Régies: », « Sources: », « Villes: undefined villes couvertes »), une grille Villes / Régies / Types
 * à « undefined » / 0 / 0 et deux blocs vides (types, top 20 villes) — défaut corrigé, listé au rapport.
 * Les 1 253 panneaux actifs sont ceux d'une campagne (TF4), plus un inventaire de régies : l'écran des
 * campagnes sera refait après la revue UX de la carte, ce n'est pas au lot 6 d'inventer ces champs.
 *
 * Aucune lecture : les statistiques sont celles de l'écran (`sources-stats`, lues une fois).
 * Couleurs (C9) : `C.warn` → `--warning` ; `${C.warn}44` (CSS invalide chez React, donc sans bord) →
 * `--warning` à 27 %, comme la tuile et le badge de T18.
 */
@Component({
  selector: 'mg-sources-ooh',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total(); as t) {
      <div class="colonne">
        <div class="bandeau">
          <div class="corps">
            <div class="bandeau-titre" data-titre>Data Lake OOH — panneaux_affichage</div>
            <div class="lignes">
              <span data-table><span class="cle">Table: </span><span class="accent">panneaux_affichage</span> (actif = true)</span>
            </div>
          </div>
          <div class="droite">
            <div class="grand-total" data-total>{{ t }}</div>
            <div class="unite" data-unite>panneaux actifs</div>
          </div>
        </div>
      </div>
    } @else if (chargement()) {
      <div class="message" data-chargement><mg-icone nom="chargement" [taille]="18" class="tourne" /> Chargement...</div>
    } @else {
      <div class="message" data-vide>Aucune donnée.</div>
    }
  `,
  styleUrl: './panneaux-commun.css',
  styles: `:host { --teinte: var(--warning); --teinte-texte: var(--warning-texte); --bord: 27%; }`,
})
export class OohComponent {
  readonly stats = input<StatsSources | null>(null);
  readonly chargement = input(false);

  protected readonly total = computed(() => {
    const s = this.stats();
    return s ? formaterNombre(s.ooh.total) : null;
  });
}
