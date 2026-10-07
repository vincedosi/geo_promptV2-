import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IrisService } from '../../couches/iris.service';
import { IRIS_DB_COLUMNS } from '../../logique/iris-colonnes';
import { LIBELLE_NIVEAU } from '../../logique/iris-echelle';
import { IRIS_PALETTES } from '../../logique/palettes-donnees-carte';
import { IRIS_ZOOM_PLANCHER } from '../../logique/versions';

/**
 * Les indicateurs proposés, groupés pour les `<optgroup>` dans l'ordre de PREMIÈRE apparition du groupe — le `reduce`
 * dans une `Map` de `IrisSection.tsx:193-205`, booléens exclus (`is_true_iris` n'est pas choroplèthable).
 */
const GROUPES = (() => {
  const parGroupe = new Map<string, (typeof IRIS_DB_COLUMNS)[number][]>();
  for (const col of IRIS_DB_COLUMNS.filter((c) => c.type !== 'boolean')) {
    if (!parGroupe.has(col.group)) parGroupe.set(col.group, []);
    parGroupe.get(col.group)!.push(col);
  }
  return [...parGroupe].map(([nom, colonnes]) => ({ nom, colonnes }));
})();

/**
 * La section « IRIS » du groupe Socio-démographie — portage de `filter-panel/IrisSection.tsx`.
 *
 * Comme les carreaux (`PanneauCalques.tsx:311-322`), l'en-tête ALLUME / éteint la couche, et les réglages ne s'affichent
 * que la couche active. Deux lignes expliquent ce que la carte montre :
 * - sous le plancher de zoom, un bandeau (MapLibre ne demande alors AUCUNE tuile, en silence) et « Zoomer », qui
 *   rejoue l'allumage — c'est lui qui porte la remontée de caméra ;
 * - au-dessus, le PALIER servi (`get_iris_tile` agrège sous z9) : taire qu'on regarde des départements ferait lire une
 *   valeur départementale comme une valeur d'IRIS.
 * La légende n'est pas ici : c'est la légende unique de la carte (`mg-legende-carte`).
 *
 * Écarts voulus, tous de couleur (règle du propriétaire : jamais de couleur en dur) : les fonds
 * `rgba(255,255,255,0.06|0.02)` deviennent `--text-primary` à 6 % / 2 % ; le liseré `rgba(78,205,196,0.25)` le teal à
 * 25 % ; le bandeau `rgba(247,183,49,0.1|0.2)` le jeton `--warning` à 10 % / 20 % (identiques en sombre, la teinte
 * du thème clair en clair).
 */
@Component({
  selector: 'mg-section-iris',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button
      type="button"
      data-entete-iris
      [attr.aria-expanded]="i.visible()"
      (click)="i.basculer(!i.visible())"
      class="flex w-full cursor-pointer items-center gap-2 border-b-fin border-l-2 border-t border-b-subtle border-l-[color-mix(in_srgb,var(--brand-teal)_25%,transparent)] border-t-subtle bg-elevated px-[14px] py-[10px] transition-[background-color] duration-[180ms] ease-[var(--ease-out)]"
    >
      <span class="flex-1 text-left text-[12px] font-medium text-primary">IRIS@if (i.visible()) {<span data-actif class="ml-1.5 text-success">●</span>}</span>
      <span class="text-[10px] text-tertiary">{{ i.visible() ? '▲' : '▼' }}</span>
    </button>
    @if (i.visible()) {
      <div data-reglages class="flex flex-col gap-[10px] border-b-fin border-subtle p-4">
        <button
          type="button"
          data-bascule
          (click)="i.basculer(!i.visible())"
          class="flex w-full cursor-pointer items-center gap-2 rounded-[4px] border-fin border-default bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] px-[10px] py-1.5"
        >
          <span class="flex size-[11px] shrink-0 items-center justify-center rounded-[2px] border-fin border-primary bg-[var(--text-primary)]">
            <span class="text-[7px] font-bold text-[var(--bg-primary)]">✓</span>
          </span>
          <span class="text-[13px] text-primary">Couche IRIS</span>
        </button>

        @if (i.sousLePlancher()) {
          <div
            data-sous-plancher
            class="flex items-center gap-2 rounded-[4px] border-fin border-[color-mix(in_srgb,var(--warning)_20%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[10px] py-2"
          >
            <span class="flex-1 text-[11px] leading-[1.4] text-warning">
              Trop loin pour les IRIS — lisibles à partir du zoom {{ plancher }}@if (texteZoom(); as z) {<span class="font-mono text-tertiary">{{ z }}</span>}
            </span>
            <!-- Réactiver la couche déjà active : la bascule porte la remontée de caméra, elle n'est pas dupliquée ici. -->
            <button
              type="button"
              (click)="i.basculer(true)"
              class="shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] border-fin border-warning bg-transparent px-2 py-[3px] text-[11px] font-medium text-warning"
            >Zoomer</button>
          </div>
        }

        @if (palier(); as p) {
          <div data-palier class="flex items-center gap-1.5 px-0.5">
            <span class="text-[11px] text-tertiary">Affiché</span>
            <span class="text-[11px] text-secondary">{{ p.libelle }}</span>
            @if (!p.iris) {
              <span class="ml-auto text-[10px] text-tertiary">zoomer pour les IRIS</span>
            }
          </div>
        }

        <button
          type="button"
          data-vrais-iris
          [attr.aria-pressed]="i.vraisSeulement()"
          (click)="i.vraisSeulement.set(!i.vraisSeulement())"
          class="flex w-full cursor-pointer items-center gap-2 rounded-[4px] border-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)] px-[10px] py-1.5"
        >
          <span
            class="flex size-[11px] shrink-0 items-center justify-center rounded-[2px] border-fin"
            [class.border-primary]="i.vraisSeulement()"
            [style.background]="i.vraisSeulement() ? 'var(--text-primary)' : 'transparent'"
            [class.border-default]="!i.vraisSeulement()"
          >
            @if (i.vraisSeulement()) {<span class="text-[7px] font-bold text-[var(--bg-primary)]">✓</span>}
          </span>
          <span class="flex-1 text-left text-[12px] text-secondary">Vrais IRIS uniquement</span>
          <span class="text-[10px] text-tertiary">{{ i.vraisSeulement() ? '16 k quartiers' : '49 k (+ communes)' }}</span>
        </button>

        <select
          data-indicateur
          aria-label="Indicateur"
          [value]="i.indicateur()"
          (change)="i.indicateur.set($any($event.target).value)"
          class="w-full cursor-pointer rounded-[4px] border-fin border-subtle bg-elevated px-2 py-1.5 text-[13px] text-primary outline-none"
        >
          @for (g of groupes; track g.nom) {
            <optgroup [label]="g.nom" class="text-tertiary">
              @for (col of g.colonnes; track col.name) {
                <option [value]="col.name" [selected]="col.name === i.indicateur()">{{ col.label }}</option>
              }
            </optgroup>
          }
        </select>

        <div>
          <div class="mb-[5px] text-[11px] font-medium text-tertiary">Palette</div>
          <div class="flex flex-wrap gap-1">
            @for (p of palettes; track p.id) {
              <button
                type="button"
                [attr.data-palette]="p.id"
                [title]="p.label"
                [attr.aria-pressed]="i.palette() === p.id"
                (click)="i.palette.set(p.id)"
                class="flex h-3 w-7 cursor-pointer overflow-hidden rounded-[3px] border-[1.5px] border-solid bg-transparent p-0"
                [class.border-primary]="i.palette() === p.id"
                [class.border-transparent]="i.palette() !== p.id"
              >
                @for (s of p.stops; track $index) {
                  <span class="flex-1" [style.background]="s"></span>
                }
              </button>
            }
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <span class="whitespace-nowrap text-[11px] font-medium text-tertiary">Opacité</span>
          <input
            type="range" min="0.1" max="1" step="0.05"
            data-opacite
            aria-label="Opacité"
            [value]="i.opacite()"
            (input)="i.reglerOpacite(+$any($event.target).value)"
            class="h-1 flex-1 cursor-pointer accent-[var(--text-primary)]"
          />
          <span class="min-w-[26px] text-right font-mono text-[11px] text-tertiary">{{ pourcentOpacite() }}%</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            type="button"
            data-relief
            [attr.aria-pressed]="i.relief()"
            (click)="i.basculerRelief(!i.relief())"
            class="flex cursor-pointer items-center gap-1.5 self-start rounded-[6px] border-fin bg-transparent px-[10px] py-[5px] text-[11px] font-medium"
            [class.border-teal]="i.relief()"
            [class.text-teal]="i.relief()"
            [class.border-subtle]="!i.relief()"
            [class.text-tertiary]="!i.relief()"
          >Relief 3D{{ i.relief() ? ' ✓' : '' }}</button>
          @if (i.relief()) {
            <!-- Exagération en multiples de la maille, jamais en mètres : un IRIS parisien fait 0,06 km², un rural 30. -->
            <div class="flex items-center gap-1.5">
              <span class="whitespace-nowrap text-[11px] font-medium text-tertiary">Relief</span>
              <input
                type="range" min="0.25" max="5" step="0.25"
                data-hauteur
                aria-label="Relief"
                [value]="i.hauteur()"
                (input)="i.hauteur.set(+$any($event.target).value)"
                class="h-1 flex-1 cursor-pointer accent-[var(--text-primary)]"
              />
              <span class="min-w-[38px] text-right font-mono text-[11px] text-tertiary">×{{ texteHauteur() }}</span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class SectionIrisComponent {
  protected readonly i = inject(IrisService);
  protected readonly groupes = GROUPES;
  protected readonly palettes = IRIS_PALETTES;
  protected readonly plancher = IRIS_ZOOM_PLANCHER;
  protected readonly pourcentOpacite = computed(() => Math.round(this.i.opacite() * 100));
  /** `IrisSection.tsx:266` mot pour mot : « 1.5 », « 2 », « 0.25 » (point décimal, comme React). */
  protected readonly texteHauteur = computed(() => this.i.hauteur().toFixed(2).replace(/0$/, '').replace(/[.,]$/, ''));
  /** ` (z3.2)` (`IrisSection.tsx:126`) : une décimale, point décimal, comme React. */
  protected readonly texteZoom = computed(() => {
    const z = this.i.zoomCourant();
    return z === null ? null : ` (z${z.toFixed(1)})`;
  });
  /** Le palier servi, seulement couche allumée au-dessus du plancher (`IrisSection.tsx:152`). */
  protected readonly palier = computed(() => {
    const n = this.i.niveau();
    if (!this.i.visible() || n === null || this.i.sousLePlancher()) return null;
    return { libelle: LIBELLE_NIVEAU[n], iris: n === 'iris' };
  });
}
