import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { ColumnInfo, GeoMode } from '../../logique/types/import-poi';
import { ImportPoiService } from '../etat/import-poi.service';
import { GENESIS_FIELDS_POI, GEO_MODES } from '../logique/constantes';

let suivant = 0;

/**
 * `ColSelect` (`MappingStep.tsx:145-190`) : libellé, sélecteur d'une colonne du fichier, exemple de la
 * colonne choisie (sa première valeur). Libellé relié au sélecteur (`for` / `id`), React n'en avait pas.
 */
@Component({
  selector: 'mg-import-choix-colonne',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ligne': '' },
  styles: [`
    :host { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    label { font-family: var(--font-sans); font-size: 9px; font-weight: 500; color: var(--text-primary); min-width: 130px; margin: 0; flex-shrink: 0; }
    select {
      flex: 1; background: var(--bg-primary); border: 1px solid var(--border-subtle); border-radius: 2px; color: var(--text-primary);
      font-family: var(--font-mono); font-size: 11px; padding: 5px 8px; outline: none; min-width: 0;
    }
    select:focus-visible { border-color: var(--brand-teal-50); }
    .exemple {
      font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); max-width: 180px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
    }
  `],
  template: `
    <label [attr.for]="id">{{ libelle() }}</label>
    <select [id]="id" (change)="choisi.emit($any($event.target).value)">
      <option value="" [selected]="!valeur()">— Non mappe —</option>
      @for (col of colonnes(); track col.name) {
        <option [value]="col.name" [selected]="col.name === valeur()">{{ col.name }}</option>
      }
    </select>
    @if (exemple() !== null) {
      <span class="exemple" data-exemple>ex: {{ exemple() }}</span>
    }
  `,
})
export class ChoixColonneComponent {
  readonly colonnes = input.required<readonly ColumnInfo[]>();
  readonly libelle = input.required<string>();
  readonly valeur = input<string | undefined>('');
  readonly choisi = output<string>();
  protected readonly id = `import-poi-colonne-${++suivant}`;
  protected readonly exemple = computed(() => {
    const col = this.colonnes().find((c) => c.name === this.valeur());
    return col && col.sampleValues.length > 0 ? col.sampleValues[0] : null;
  });
}

/**
 * Étape 03 « Mapping colonnes » — portage de `app/admin/import/_components/MappingStep.tsx` (lot 6, T12) :
 * six champs standards, puis le mode de géolocalisation (GPS, géocodage BAN, Lambert 93) et ses colonnes.
 * Pré-rempli par la suggestion de la route (`ImportPoiService.analyser`).
 *
 * Écarts à React, voulus : libellés reliés aux sélecteurs ; le mode se choisit aussi au clavier (vrais
 * boutons radio d'un même groupe) ; couleurs (C9) : `#505050` → `--text-tertiary`, teal en texte lisible
 * en clair. Gardés par parité : textes sans accents (« Non mappe », « deja presentes »…), libellés 9 px.
 */
@Component({
  selector: 'mg-import-correspondance',
  imports: [ChoixColonneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './badges.css', './correspondance.component.css'],
  templateUrl: './correspondance.component.html',
})
export class CorrespondanceComponent {
  protected readonly etat = inject(ImportPoiService);
  protected readonly champs = GENESIS_FIELDS_POI;
  protected readonly modes = GEO_MODES;
  protected readonly geo = computed(() => this.etat.correspondanceGeo());

  protected choisirMode(mode: GeoMode): void {
    this.etat.choisirModeGeo(mode);
  }
}
