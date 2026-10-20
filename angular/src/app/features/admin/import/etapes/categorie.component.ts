import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { ImportPoiService } from '../etat/import-poi.service';

/**
 * Étape 02 « Categorie POI » — portage de `app/admin/import/_components/CategoryStep.tsx` (lot 6, T12).
 * Liste lue au montage de la page (`ImportPoiService.charger`) ; le volet replié crée une catégorie à la
 * volée (⚠ ÉCRIT dans `poi_categories`), relit la liste puis la choisit.
 *
 * Écarts à React, voulus : libellés reliés à leur champ (`for` / `id`) ; refus de création notifié (React
 * se taisait) ; bouton « Creer » : texte `--success` lisible en clair (le `#3dffa0` de React ≈ 1,4:1 sur
 * fond clair) — la teinte reste celle du jeton, assombri en thème clair ; teal du résumé lisible en clair.
 * Gardés par parité : textes sans accents, exemple « Ex: cirfa, commerce, sante... » (des catégories
 * génériques, pas des marques), option vide désactivée, « Chargement... » tant que la liste est vide.
 */
@Component({
  selector: 'mg-import-categorie',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './badges.css'],
  styles: [`
    .corps { display: flex; flex-direction: column; gap: 10px; }
    label { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-primary); margin: 0; display: block; margin-bottom: 6px; }
    .rangee { display: flex; gap: 8px; align-items: center; }
    select { max-width: 300px; width: 100%; padding: 6px 10px; }
    select.vide { color: var(--text-tertiary); }
    option { color: var(--text-primary); }
    .chargement { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
    details { margin-top: 8px; }
    .creation { margin-top: 8px; }
    summary { font-family: var(--font-sans); font-size: 9px; font-weight: 500; color: var(--teal-texte); cursor: pointer; }
    input[type='text'] { max-width: 250px; width: 100%; padding: 5px 8px; }
    .creer {
      font-family: var(--font-sans); font-size: 12px; font-weight: 500; background: color-mix(in srgb, var(--success) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--success) 30%, transparent); border-radius: 2px; color: var(--success-texte);
      padding: 7px 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    }
    .creer:disabled { opacity: 0.5; cursor: default; }
  `],
  template: `
    <div class="carte">
      <div class="entete">
        <span class="num" data-num>02</span>
        <span class="titre" data-titre>Categorie POI</span>
      </div>
      <div class="corps">
        <div>
          <label for="import-poi-categorie">Categorie</label>
          <div class="rangee">
            <select id="import-poi-categorie" [class.vide]="!etat.categorie()" (change)="choisir($event)">
              <option value="" disabled [selected]="!etat.categorie()">-- Choisir une categorie --</option>
              @for (c of etat.categories(); track c.val) {
                <option [value]="c.val" [selected]="c.val === etat.categorie()">{{ c.icone ? c.icone + ' ' + c.label : c.label }}</option>
              }
            </select>
            @if (vide()) {
              <span class="chargement" data-chargement>Chargement...</span>
            }
          </div>
          <details data-creation>
            <summary>+ Creer une nouvelle categorie</summary>
            <div class="rangee creation">
              <input
                type="text"
                aria-label="Nom de la nouvelle catégorie"
                placeholder="Ex: cirfa, commerce, sante..."
                [value]="etat.nouvelleCategorie()"
                (input)="saisir($event)"
              />
              <button type="button" class="creer" data-creer [disabled]="creerDesactive()" (click)="etat.creerCategorie()">
                @if (etat.creationEnCours()) {
                  <mg-icone nom="chargement" [taille]="10" class="tourne" />
                } @else {
                  Creer
                }
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  `,
})
export class CategorieComponent {
  protected readonly etat = inject(ImportPoiService);
  protected readonly vide = computed(() => this.etat.categories().length === 0);
  protected readonly creerDesactive = computed(() => !this.etat.nouvelleCategorie().trim() || this.etat.creationEnCours());

  protected choisir(e: Event): void {
    this.etat.choisirCategorie((e.target as HTMLSelectElement).value);
  }

  protected saisir(e: Event): void {
    this.etat.nouvelleCategorie.set((e.target as HTMLInputElement).value);
  }
}
