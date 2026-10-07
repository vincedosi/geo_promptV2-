import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CarreauxService } from '../../couches/carreaux.service';
import { CARREAUX_INDICATEURS } from '../../logique/carreaux/catalogue';
import { CARREAUX_PALETTES } from '../../logique/palettes-donnees-carte';

/** Les indicateurs groupés pour les `<optgroup>`, dans l'ordre du catalogue (`CarreauxSection.tsx:100-106`). */
const GROUPES = [...new Set(CARREAUX_INDICATEURS.map((i) => i.group))].map((g) => ({
  nom: g,
  indicateurs: CARREAUX_INDICATEURS.filter((i) => i.group === g),
}));

/**
 * La section « Carreaux » du groupe Socio-démographie — portage de `filter-panel/CarreauxSection.tsx`.
 *
 * Comme `PanneauCalques.tsx:311-322`, l'en-tête de la section ALLUME / éteint la couche : ses réglages (indicateur,
 * palette, opacité, relief) ne s'affichent que la couche active. La légende n'est pas ici : c'est la légende unique de
 * la carte (`mg-legende-carte`), cliquable par palier.
 *
 * Écarts voulus, tous de couleur (règle du propriétaire : jamais de couleur en dur) : les fonds `rgba(255,255,255,0.06)`
 * / `0.02` du bouton deviennent `--text-primary` à 6 % / 2 % (identiques en sombre à ±4/255, visibles en clair où le
 * blanc ne se voyait pas) ; le liseré `rgba(78,205,196,0.25)` devient le teal à 25 % (exact, le teal est invariant).
 * « Carreaux ✓ » garde sa coche : `carreauxLoaded` vaut `true` en permanence côté React (`useMapLayers.ts:149`).
 */
@Component({
  selector: 'mg-section-carreaux',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button
      type="button"
      data-entete-carreaux
      [attr.aria-expanded]="c.visible()"
      (click)="c.basculer(!c.visible())"
      class="flex w-full cursor-pointer items-center gap-2 border-b-fin border-l-2 border-t border-b-subtle border-l-[color-mix(in_srgb,var(--brand-teal)_25%,transparent)] border-t-subtle bg-elevated px-[14px] py-[10px] transition-[background-color] duration-[180ms] ease-[var(--ease-out)]"
    >
      <span class="flex-1 text-left text-[12px] font-medium text-primary">Carreaux</span>
      <span class="text-[10px] text-tertiary">{{ c.visible() ? '▲' : '▼' }}</span>
    </button>
    @if (c.visible()) {
      <div data-reglages class="flex flex-col gap-[10px] border-b-fin border-subtle p-4">
        <button
          type="button"
          data-bascule
          (click)="c.basculer(!c.visible())"
          class="flex w-full cursor-pointer items-center gap-2 rounded-[4px] border-fin border-default bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] px-[10px] py-1.5"
        >
          <span class="flex size-[11px] shrink-0 items-center justify-center rounded-[2px] border-fin border-primary bg-[var(--text-primary)]">
            <span class="text-[7px] font-bold text-[var(--bg-primary)]">✓</span>
          </span>
          <span class="text-[13px] text-primary">Carreaux ✓</span>
        </button>

        <select
          data-indicateur
          aria-label="Indicateur"
          [value]="c.indicateur()"
          (change)="c.indicateur.set($any($event.target).value)"
          class="w-full cursor-pointer rounded-[4px] border-fin border-subtle bg-elevated px-2 py-1.5 text-[13px] text-primary outline-none"
        >
          @for (g of groupes; track g.nom) {
            <optgroup [label]="g.nom" class="text-tertiary">
              @for (ind of g.indicateurs; track ind.id) {
                <option [value]="ind.id" [selected]="ind.id === c.indicateur()">{{ ind.label }}</option>
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
                [attr.aria-pressed]="c.palette() === p.id"
                (click)="c.palette.set(p.id)"
                class="flex h-3 w-7 cursor-pointer overflow-hidden rounded-[3px] border-[1.5px] border-solid bg-transparent p-0"
                [class.border-primary]="c.palette() === p.id"
                [class.border-transparent]="c.palette() !== p.id"
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
            [value]="c.opacite()"
            (input)="c.opacite.set(+$any($event.target).value)"
            class="h-1 flex-1 cursor-pointer accent-[var(--text-primary)]"
          />
          <span class="min-w-[26px] text-right font-mono text-[11px] text-tertiary">{{ pourcentOpacite() }}%</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            type="button"
            data-relief
            [attr.aria-pressed]="c.relief()"
            (click)="c.basculerRelief(!c.relief())"
            class="flex cursor-pointer items-center gap-1.5 self-start rounded-[6px] border-fin bg-transparent px-[10px] py-[5px] text-[11px] font-medium"
            [class.border-teal]="c.relief()"
            [class.text-teal]="c.relief()"
            [class.border-subtle]="!c.relief()"
            [class.text-tertiary]="!c.relief()"
          >Relief 3D{{ c.relief() ? ' ✓' : '' }}</button>
          @if (c.relief()) {
            <!-- Exagération en multiples de la maille, jamais en mètres (useMapLayers.ts:374-405). -->
            <div class="flex items-center gap-1.5">
              <span class="whitespace-nowrap text-[11px] font-medium text-tertiary">Relief</span>
              <input
                type="range" min="0.25" max="5" step="0.25"
                data-hauteur
                aria-label="Relief"
                [value]="c.hauteur()"
                (input)="c.hauteur.set(+$any($event.target).value)"
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
export class SectionCarreauxComponent {
  protected readonly c = inject(CarreauxService);
  protected readonly groupes = GROUPES;
  protected readonly palettes = CARREAUX_PALETTES;
  protected readonly pourcentOpacite = computed(() => Math.round(this.c.opacite() * 100));
  /** `CarreauxSection.tsx:169` mot pour mot : « 1.5 », « 2 », « 0.25 » (point décimal, comme React). */
  protected readonly texteHauteur = computed(() => this.c.hauteur().toFixed(2).replace(/0$/, '').replace(/[.,]$/, ''));
}
