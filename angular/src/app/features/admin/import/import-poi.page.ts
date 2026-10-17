import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CategorieComponent } from './etapes/categorie.component';
import { ColonnesComponent } from './etapes/colonnes.component';
import { CorrespondanceComponent } from './etapes/correspondance.component';
import { DepotComponent } from './etapes/depot.component';
import { EssaiComponent } from './etapes/essai.component';
import { GeocodageComponent } from './etapes/geocodage.component';
import { ImportComponent } from './etapes/import.component';
import { ImportPoiService } from './etat/import-poi.service';

/**
 * `admin/donnees/importer/poi` — portage de `app/admin/import/page.tsx` (lot 6, T12), type « POI » de
 * l'onglet « Importer » de la page Données (amendement A7), en tête : c'est l'import le plus courant ;
 * `admin/import` y redirige.
 *
 * Sept étapes, chacune rendue quand la précédente est remplie (`ImportPoiService.etapeAccessible`, mêmes
 * règles que React) : T12 — 01 dépôt, 02 catégorie, 03 correspondance, 03b colonnes ; T13 — 03c géocodage
 * (mode adresse : 04 attend sa validation), 04 essai à blanc, 05 import en flux SSE (confirmation, progression,
 * journal, rapport).
 *
 * Fournit `ImportPoiService`, l'état que React tient au niveau de la PAGE : détruit avec elle, il repart
 * vide au retour, comme un nouveau montage. Les deux lectures du montage (organisations, catégories)
 * partent ici, une fois par écran.
 *
 * Écarts à React, voulus : le titre « Import POI » (`h1`) est porté par le cadre (« Données », onglet
 * « Importer », type « POI ») — un seul titre de page, comme Radio (T16) et l'IRIS crawler (T15) ;
 * couleurs (C9) : badge « Admin » `#fbbf24` → `--warning`, `rgba(251,191,36,…)` → `color-mix` ;
 * `#505050` du pied → `--text-tertiary`. Largeur 900 px de React gardée.
 */
@Component({
  selector: 'mg-import-poi',
  imports: [DepotComponent, CategorieComponent, CorrespondanceComponent, ColonnesComponent, GeocodageComponent, EssaiComponent, ImportComponent],
  providers: [ImportPoiService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-poi.page.html',
  styles: [`
    :host {
      display: block; max-width: 900px; font-family: var(--font-sans); color: var(--text-primary);
      /* Vert de --success en texte lisible en clair (≈ 2,5:1 sinon), de même l'ambre du badge « Admin » (≈ 2,9:1) : recette light-dark du teal de T16. */
      --vert-texte: light-dark(color-mix(in srgb, var(--success) 50%, var(--text-primary)), var(--success));
      --ambre-texte: light-dark(color-mix(in srgb, var(--warning) 50%, var(--text-primary)), var(--warning));
    }
    .entete { margin-bottom: 20px; }
    .badges { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
    .badge {
      font-family: var(--font-sans); font-size: 11px; font-weight: 500; border-radius: 2px; padding: 2px 6px;
      display: inline-block; border: 1px solid;
    }
    .badge.avertissement {
      color: var(--ambre-texte); background: color-mix(in srgb, var(--warning) 10%, transparent);
      border-color: color-mix(in srgb, var(--warning) 30%, transparent);
    }
    .badge.vert {
      color: var(--vert-texte); background: color-mix(in srgb, var(--success) 12%, transparent);
      border-color: color-mix(in srgb, var(--success) 30%, transparent);
    }
    .sous-titre { font-family: var(--font-sans); font-size: 12px; color: var(--text-secondary); margin: 0; }
    .etapes { display: flex; flex-direction: column; gap: 16px; }
    .pied { padding: 12px 0; font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); border-top: 1px solid var(--border-subtle); }
  `],
})
export class ImportPoiPage {
  protected readonly etat = inject(ImportPoiService);
  protected readonly analysee = computed(() => this.etat.analyse()?.success === true);

  constructor() {
    this.etat.charger();
  }
}
