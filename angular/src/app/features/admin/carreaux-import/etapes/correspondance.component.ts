import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { ImportShapefileService } from '../etat/import-shapefile.service';
import { EXCLUE } from '../logique/lots';

/**
 * Étape 2 de l'import Shapefile — portage de `app/admin/carreaux-import/_components/MappingStep.tsx` (lot 6,
 * T14) : résolution, millésime, colonne d'identité, puis la correspondance des colonnes du `.dbf` (incluse ou
 * non dans `metadata`, renommée ou non), le résumé et « Lancer l'import » (qui ouvre l'étape 3, sans rien
 * envoyer).
 *
 * Écarts à React, voulus : libellés reliés à leurs champs (`for` / `id` ; React : `<label>` orphelins) ; case et
 * champ de chaque ligne nommés (`aria-label`) ; couleurs en jetons (C9) ; focus visible (React : `outline:
 * none`). Gardés : textes (dont « Décochez celles à ignorer. »), grille `36px 1fr 160px 148px`, champ cible de
 * 140 px, opacité 0,4 d'une ligne exclue, valeur exemple de la PREMIÈRE entité, « — » si elle est nulle.
 */
@Component({
  selector: 'mg-shapefile-correspondance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './etape-shapefile.css',
  template: `
    <div class="pile">
      <div class="reglages">
        <div class="carte reglage">
          <label for="shp-resolution">Résolution</label>
          <select id="shp-resolution" [value]="etat.resolution()" (change)="etat.resolution.set($any($event.target).value)">
            <option value="200m">200m × 200m</option>
            <option value="1km">1km × 1km</option>
          </select>
        </div>
        <div class="carte reglage">
          <label for="shp-millesime">Millésime</label>
          <input id="shp-millesime" type="text" placeholder="2021" [value]="etat.millesime()" (input)="etat.millesime.set($any($event.target).value)" />
        </div>
        <div class="carte reglage">
          <label for="shp-id">Colonne ID (idcar)</label>
          <select id="shp-id" (change)="etat.idColumn.set($any($event.target).value)">
            <option value="" [selected]="etat.idColumn() === ''">— Auto-index —</option>
            @for (f of etat.fields(); track f.name) {
              <option [value]="f.name" [selected]="etat.idColumn() === f.name">{{ f.name }}</option>
            }
          </select>
        </div>
      </div>

      <div class="carte tableau">
        <div class="entete-tableau">
          <div>
            <p class="titre">Mapping des colonnes</p>
            <p class="mono note">Sélectionnez les colonnes à inclure dans les metadata JSONB. Décochez celles à ignorer.</p>
          </div>
          <div class="actions">
            <button type="button" class="outil" (click)="etat.inclureTout()">Tout inclure</button>
            <button type="button" class="outil" (click)="etat.exclureTout()">Tout exclure</button>
          </div>
        </div>
        <div class="defilement">
          <div class="grille en-tetes">
            <span></span><span>Colonne source</span><span>Valeur exemple</span><span>Nom cible</span>
          </div>
          @for (l of lignes(); track l.source; let i = $index) {
            <div class="grille ligne" [class.exclue]="!l.incluse" data-ligne>
              <input
                type="checkbox"
                [checked]="l.incluse"
                [attr.aria-label]="'Inclure ' + l.source"
                (change)="etat.inclure(i, $any($event.target).checked)"
              />
              <div>
                <span class="mono source">{{ l.source }}</span>
                <span class="mono genre">{{ l.genre }}</span>
              </div>
              <div class="exemple"><span class="mono">{{ l.exemple }}</span></div>
              <input
                type="text"
                class="cible"
                placeholder="(nom original)"
                [attr.aria-label]="'Nom cible de ' + l.source"
                [value]="l.cible"
                [disabled]="!l.incluse"
                (input)="etat.renommer(i, $any($event.target).value)"
              />
            </div>
          }
        </div>
      </div>

      <div class="pied">
        <div class="mono compte" data-compte>{{ compte() }}</div>
        <div class="boutons">
          <button type="button" class="secondaire" (click)="etat.choisirEtape(1)">Retour</button>
          <button type="button" class="principal lancer" (click)="etat.choisirEtape(3)">Lancer l'import</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .reglages { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .reglage { padding: 16px; }
    label, .titre { display: block; font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-primary); }
    label { margin-bottom: 8px; }
    .reglage select, .reglage input { width: 100%; padding: 8px 10px; font-size: 12px; }
    .tableau { overflow: hidden; }
    .entete-tableau {
      padding: 14px 20px; border-bottom: 1px solid var(--border-subtle);
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
    }
    .note { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
    .actions { display: flex; gap: 8px; }
    .outil {
      padding: 5px 12px; border-radius: 2px; background: var(--bg-level-2); border: 1px solid var(--border-subtle);
      font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
      white-space: nowrap;
    }
    .defilement { max-height: 480px; overflow-y: auto; }
    .grille { display: grid; grid-template-columns: 36px 1fr 160px 148px; align-items: center; }
    .en-tetes {
      padding: 6px 20px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-level-2);
      font-family: var(--font-sans); font-size: 11px; color: var(--text-tertiary);
    }
    .ligne { padding: 8px 20px; border-bottom: 1px solid var(--border-subtle); transition: opacity 0.15s; }
    .ligne.exclue { opacity: 0.4; background: var(--bg-level-2); }
    input[type='checkbox'] { width: 14px; height: 14px; accent-color: var(--brand-teal); cursor: pointer; border-radius: 2px; margin: 0; }
    .source { font-size: 12px; color: var(--text-primary); font-weight: 500; }
    .genre { font-size: 10px; color: var(--text-tertiary); margin-left: 8px; }
    .exemple { overflow: hidden; }
    .exemple span {
      font-size: 11px; color: var(--text-tertiary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cible { width: 140px; padding: 4px 8px; font-size: 11px; color: var(--text-secondary); }
    .cible:disabled { opacity: 0.3; }
    .pied { display: flex; align-items: center; justify-content: space-between; }
    .compte { font-size: 12px; color: var(--text-secondary); }
    .boutons { display: flex; gap: 10px; }
    .lancer { padding: 10px 24px; }
  `,
})
export class CorrespondanceComponent {
  protected readonly etat = inject(ImportShapefileService);

  protected readonly lignes = computed(() => {
    const fields = this.etat.fields();
    const premiere = this.etat.features()[0];
    return this.etat.mappings().map((m, i) => {
      const exemple = premiere ? premiere.properties[m.source] : null;
      const type = fields[i]?.type;
      return {
        source: m.source,
        incluse: m.target !== EXCLUE,
        cible: m.target === EXCLUE ? '' : m.target,
        genre: type === 'N' || type === 'F' ? 'numérique' : 'texte',
        exemple: exemple != null ? String(exemple) : '—',
      };
    });
  });

  /**
   * « N / M colonnes sélectionnées · K features à insérer » (l.355-357) : le JSX joint ses deux lignes par une
   * espace, puis `&nbsp;·&nbsp;` et l'espace qui suit — le texte rendu par React, caractère pour caractère.
   */
  protected readonly compte = computed(() => {
    const ms = this.etat.mappings();
    const retenues = ms.filter((m) => m.target !== EXCLUE).length;
    return `${retenues} / ${ms.length} colonnes sélectionnées  ·  ${formaterNombre(this.etat.features().length)} features à insérer`;
  });
}
