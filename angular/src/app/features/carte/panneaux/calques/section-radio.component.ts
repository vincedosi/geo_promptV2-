import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { RadioService } from '../../couches/radio.service';
import { COULEURS_COUVERTURE_RADIO } from '../../logique/palettes-donnees-carte';
import { type ElementListe, ListeMultipleComponent } from '../filtre/liste-multiple.component';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { RechercheRadioComponent } from './recherche-radio.component';
import { SelectionsCalquesService } from './selections-calques.service';

/** Catégories Arcom proposées à l'exclusion (`RADIO_EXCLUDABLE_CATEGORIES`, `RadioSection.tsx:21-29`, verbatim). */
export const CATEGORIES_EXCLUABLES: readonly ElementListe[] = [
  { id: 'D,E,P', label: 'Toutes nationales (D/E/P)' },
  { id: 'D', label: 'D — Thematiques nationales' },
  { id: 'E', label: 'E — Generalistes nationales' },
  { id: 'P', label: 'P — Service public' },
  { id: 'A', label: 'A — Associatives' },
  { id: 'B', label: 'B — Locales commerciales' },
  { id: 'C', label: 'C — Franchises locales' },
];

/** Systèmes de diffusion filtrables, `''` = tous (`RADIO_SYSTEMS`, `RadioSection.tsx:32-36`). */
export const SYSTEMES_RADIO: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Tous', value: '' },
  { label: 'FM', value: 'FM' },
  { label: 'DAB+', value: 'DAB+' },
];


/**
 * La section « Radio FM/DAB+ » du groupe Médias offline — portage de `filter-panel/RadioSection.tsx`.
 *
 * Présentationnelle : tout l'état vit dans `RadioService` (la couche survit à la fermeture du panneau, comme l'état de
 * `useRadioLayer` vivait dans la page). Les réglettes (opacité, contour, taille) affichent leur valeur pendant le geste
 * et ne repeignent la carte qu'au RELÂCHEMENT (`change`) — aucune ne part en requête.
 *
 * Écarts à React : la première pastille de couleur est `#4ecdc4` et non `var(--brand-teal)` (MapLibre refusait la
 * seconde ; voir `COULEURS_COUVERTURE_RADIO`) ; un échec de lecture des émetteurs est dit sous le bouton (React le
 * taisait) ; le teal à 8 % / 20 % du bandeau et à 10 % des boutons actifs passe par `color-mix` sur `--brand-teal`
 * (même valeur, le teal étant invariant).
 */
@Component({
  selector: 'mg-section-radio',
  imports: [EnteteFiltreComponent, ListeMultipleComponent, RechercheRadioComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
    input[type='range'] { width: 100%; height: 4px; cursor: pointer; accent-color: var(--brand-teal); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    <mg-entete-filtre libelle="Radio FM/DAB+" [ouvert]="ouvert()" [compte]="radio.compte()"
      (basculer)="selections.basculerSection('radio')" />
    @if (ouvert()) {
      <div class="fondu" data-contenu-radio>
        @if (radio.selection(); as s) {
          <div data-radio-choisie
            class="flex items-center gap-2 rounded-[6px] border-fin border-[color-mix(in_srgb,var(--brand-teal)_20%,transparent)] bg-[color-mix(in_srgb,var(--brand-teal)_8%,transparent)] px-[10px] py-1.5 text-[11px]">
            <span class="flex-1 font-medium text-teal">📻 {{ s.nom }}</span>
            <button type="button" data-oublier-radio aria-label="Oublier la radio choisie" (click)="radio.oublierSelection()"
              class="cursor-pointer border-0 bg-transparent p-0 text-[14px] leading-none text-tertiary transition-[color] duration-150 ease-[var(--ease-hover)] hover:text-primary">×</button>
          </div>
        }

        <div class="flex items-center gap-2">
          <button type="button" data-basculer-radio [attr.aria-pressed]="radio.visible()" (click)="radio.basculer()"
            class="flex-1 cursor-pointer rounded-[6px] border-fin px-[14px] py-2 text-[12px] font-medium transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)]"
            [class]="radio.visible() ? actif : inactif">{{ radio.visible() ? '📻 Émetteurs visibles' : '📻 Afficher les émetteurs' }}</button>
        </div>
        @if (radio.erreur(); as e) {
          <div data-erreur class="mt-1.5 font-mono text-[10px] text-danger">! {{ e }}</div>
        }

        @if (radio.visible()) {
          <div data-reglages-radio class="flex flex-col gap-2">
            <div>
              <div class="mb-1 text-[10px] text-tertiary">Rechercher une radio</div>
              <mg-recherche-radio (choisie)="radio.choisirRadio($event.id, $event.nom)" />
            </div>

            @if (radiosFiltre().length > 0) {
              <div data-filtre-radios>
                <div class="mb-1 text-[10px] text-tertiary">
                  Filtrer par radios<span class="ml-1 font-mono text-tertiary">({{ radiosFiltre().length }})</span>
                </div>
                <mg-liste-multiple libelle="Sélectionner des radios..." [items]="radiosFiltre()" [selection]="radio.radioIds()"
                  [recherchable]="true" (changer)="radio.radioIds.set($event)" />
              </div>
            }

            <div>
              <div class="mb-1 text-[10px] text-tertiary">Exclure des categories</div>
              <mg-liste-multiple libelle="Aucune exclusion" [items]="categories" [selection]="radio.categoriesExclues()"
                (changer)="radio.categoriesExclues.set($event)" />
            </div>

            <div>
              <div class="mb-1 text-[10px] text-tertiary">Système</div>
              <div class="flex gap-1">
                @for (opt of systemes; track opt.value) {
                  <button type="button" [attr.data-systeme]="opt.value" [attr.aria-pressed]="radio.systeme() === opt.value"
                    (click)="radio.systeme.set(opt.value)"
                    class="flex-1 cursor-pointer rounded-[4px] border-fin py-1 text-[10px] transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)]"
                    [class]="radio.systeme() === opt.value ? actif : systemeInactif">{{ opt.label }}</button>
                }
              </div>
            </div>

            <div class="border-t-fin border-subtle pt-2"></div>

            <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-secondary">
              <input type="checkbox" data-couverture [checked]="radio.couverture()" (change)="radio.couverture.set(!radio.couverture())"
                class="accent-[var(--brand-teal)]" />
              Zones de couverture
            </label>

            @if (radio.couverture()) {
              <div data-reglages-couverture class="flex flex-col gap-1.5 pl-5">
                <div class="mb-0.5 text-[9px] italic text-tertiary">Couverture estimée (approximation)</div>
                <div>
                  <div class="mb-[3px] text-[10px] text-tertiary">Couleur</div>
                  <div class="flex items-center gap-1">
                    @for (c of couleurs; track c) {
                      <button type="button" [attr.data-couleur]="c" [attr.aria-label]="'Couleur ' + c" [attr.aria-pressed]="radio.couleurCouverture() === c"
                        (click)="radio.couleurCouverture.set(c)"
                        class="size-4 shrink-0 cursor-pointer rounded-full border-solid transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)]"
                        [class]="radio.couleurCouverture() === c ? 'border-2 border-primary' : 'border border-hover'"
                        [style.background]="c"></button>
                    }
                    <input type="color" data-couleur-libre aria-label="Couleur libre" [value]="radio.couleurCouverture()"
                      (change)="radio.couleurCouverture.set($any($event.target).value)"
                      class="size-4 cursor-pointer border-0 bg-transparent p-0" />
                  </div>
                </div>
                <div>
                  <div class="mb-0.5 flex justify-between text-[10px] text-tertiary">
                    <span>Opacité</span><span class="font-mono text-secondary">{{ opacite() }}%</span>
                  </div>
                  <input type="range" data-opacite min="0" max="100" step="5" [value]="opacite()"
                    (input)="opacite.set(+$any($event.target).value)" (change)="radio.opaciteCouverture.set(+$any($event.target).value)" />
                </div>
                <div>
                  <div class="mb-0.5 flex justify-between text-[10px] text-tertiary">
                    <span>Contour</span><span class="font-mono text-secondary">{{ contour() }}px</span>
                  </div>
                  <input type="range" data-contour min="0" max="5" step="0.5" [value]="contour()"
                    (input)="contour.set(+$any($event.target).value)" (change)="radio.contour.set(+$any($event.target).value)" />
                </div>
              </div>
            }

            <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-secondary">
              <input type="checkbox" data-densite [checked]="radio.densite()" (change)="radio.densite.set(!radio.densite())"
                class="accent-[var(--brand-teal)]" />
              Densité (heatmap)
            </label>

            <div>
              <div class="mb-0.5 flex justify-between text-[10px] text-tertiary">
                <span>Taille points</span><span class="font-mono text-secondary">{{ taille() }}px</span>
              </div>
              <input type="range" data-taille min="2" max="12" step="1" [value]="taille()"
                (input)="taille.set(+$any($event.target).value)" (change)="radio.taillePoints.set(+$any($event.target).value)" />
            </div>

            <div class="border-t-fin border-subtle pt-1.5">
              <button type="button" data-recentrer (click)="radio.recentrerFrance()"
                class="w-full cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-3 py-[5px] text-[10px] text-tertiary transition-[background-color,border-color,color,opacity] duration-150 ease-[var(--ease-hover)] hover:border-hover hover:text-primary">
                Recentrer France
              </button>
            </div>
          </div>
        }

        <div class="font-mono text-[9px] italic text-tertiary">Source : ANFR data.gouv.fr</div>
      </div>
    }
  `,
})
export class SectionRadioComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly radio = inject(RadioService);
  protected readonly categories = CATEGORIES_EXCLUABLES;
  protected readonly systemes = SYSTEMES_RADIO;
  protected readonly couleurs = COULEURS_COUVERTURE_RADIO;
  protected readonly actif = 'border-teal text-teal bg-[color-mix(in_srgb,var(--brand-teal)_10%,transparent)]';
  protected readonly inactif = 'border-default text-secondary bg-transparent';
  protected readonly systemeInactif = 'border-default text-tertiary bg-transparent';
  protected readonly ouvert = computed(() => this.selections.sections()['radio'] !== false);
  /** `${nom} (${cat})` (`RadioSection.tsx:173`). */
  protected readonly radiosFiltre = computed<ElementListe[]>(() =>
    (this.radio.options()?.radios ?? []).map((r) => ({ id: r.id, label: `${r.nom}${r.cat ? ` (${r.cat})` : ''}` })));
  /** La valeur affichée PENDANT le geste ; la carte ne se repeint qu'au relâchement. */
  protected readonly opacite = linkedSignal(() => this.radio.opaciteCouverture());
  protected readonly contour = linkedSignal(() => this.radio.contour());
  protected readonly taille = linkedSignal(() => this.radio.taillePoints());
}
