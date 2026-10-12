import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { PoisService } from '../../couches/pois.service';
import { CataloguePoiService, type TypePoi } from '../../etat/catalogue-poi.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { PIN_COLORS, PIN_SIZES } from '../../logique/constantes-calques';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { ListeMultipleComponent } from '../filtre/liste-multiple.component';
import { SelectionsCalquesService } from './selections-calques.service';

/** Un groupe de la section (droits sur la carte, T4) : ses types et la part de LA sélection qui lui revient. */
interface GroupePoi {
  readonly origine: TypePoi['origine'];
  readonly titre: string;
  readonly types: readonly TypePoi[];
  readonly selection: readonly string[];
}

/** Les sous-titres, dans l'ordre d'affichage : ce que l'espace a importé d'abord. Libellés provisoires (spec § 4.2). */
const TITRES_GROUPES: readonly (readonly [TypePoi['origine'], string])[] = [
  ['espace', "Données de l'espace"],
  ['commune', 'Données communes'],
];

/** L'aide de l'en-tête (`TOOLTIPS.poi`, `FilterSectionHeader.tsx:21`). */
export const AIDE_POI = 'Point d\'Intérêt — commerce, service, lieu public';

/**
 * La section « Points d'intérêt (POI) » du groupe POI et mobilité — portage de `filter-panel/PoiSection.tsx`.
 *
 * Les types choisis vivent dans `EtatCarteService.poiSelectionnes` (ils survivent à la fermeture du panneau, comme
 * `selectedPOI` de `page.tsx`) ; les épingles dans `PoisService.styles`. Le catalogue est lu à la PREMIÈRE ouverture de
 * la section, une fois par écran. `risque_industriel` est retiré de la liste : la donnée a sa propre section dans le
 * groupe Environnement (`PanneauCalques.tsx:474-486`).
 *
 * Textes repris tels quels, majuscules du bouton comprises. Écarts voulus, tous de couleur (jamais une couleur en dur) :
 * les fonds blancs translucides de React (`rgba(255,255,255,…)`, `rgba(240,240,240,0.1)` — `primaryBtn` ne sait pas
 * lire `var(--success)` et retombe sur ce gris) deviennent `--text-primary` au même pourcentage : identiques en sombre,
 * visibles en clair. Le sélecteur « Nature » n'est pas porté : React ne le remplit jamais (voir `CataloguePoiService`).
 * Écart, défaut corrigé : l'échec d'une recherche est dit ICI — React l'écrivait dans le panneau de l'Assistant.
 *
 * ── DEUX GROUPES (droits sur la carte, T4) ───────────────────────────────
 * Dès qu'un type vient de l'espace actif (`origine: 'espace'`, `/api/map/categories`), la liste se coupe en
 * « Données de l'espace » puis « Données communes », une `mg-liste-multiple` chacune ; un groupe vide n'est pas rendu.
 * Tout commun (l'espace interne aujourd'hui) : le rendu d'avant, sans sous-titre. La sélection reste UNE
 * (`poiSelectionnes`) : chaque liste reçoit la part qui est à elle, et ce qu'elle émet ne remplace que cette part
 * (`changerGroupe`) — sa croix ou « Tout deselectionner » n'effacent pas l'autre groupe. `mg-liste-multiple` n'est pas
 * modifiée : sans ce filtrage, elle compterait dans son « n/N » des choix qui ne sont pas dans sa liste.
 */
@Component({
  selector: 'mg-section-poi',
  imports: [EnteteFiltreComponent, ListeMultipleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'block pb-1' },
  template: `
    <mg-entete-filtre libelle="Points d'intérêt (POI)" [ouvert]="ouvert()" [compte]="selection().length" [infobulle]="aide"
      (basculer)="selections.basculerSection('poi')" />
    @if (ouvert()) {
      <div class="fondu" data-contenu-poi>
        <div>
          <div class="mb-1.5 flex items-center justify-between text-[11px] font-medium text-secondary">
            <span>
              Types de POI@if (selection().length > 0) {<span class="text-secondary"> — {{ selection().length }} sélectionné{{ selection().length > 1 ? 's' : '' }}</span>}@if (!catalogue.chargement() && types().length > 0) {<span data-nb-types class="text-tertiary"> ({{ types().length }})</span>}
            </span>
            <button type="button" data-rafraichir title="Rafraîchir la liste" (click)="catalogue.charger(true)"
              class="cursor-pointer border-0 bg-transparent px-[2px] py-0 text-[11px] leading-none text-tertiary">{{ catalogue.chargement() ? '…' : '↻' }}</button>
          </div>
          @if (catalogue.erreur() && types().length === 0) {
            <div data-erreur-catalogue class="mb-1 font-mono text-[10px] text-danger">
              ! Erreur chargement catégories : {{ catalogue.erreur() }} — <button type="button" (click)="catalogue.charger(true)"
                class="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-warning">réessayer</button>
            </div>
          }
          @if (groupes(); as gs) {
            <div class="flex flex-col gap-2">
              @for (g of gs; track g.origine) {
                <div [attr.data-groupe-poi]="g.origine" role="group" [attr.aria-label]="g.titre">
                  <div data-sous-titre class="mb-1 text-[11px] font-medium text-secondary">{{ g.titre }}</div>
                  <mg-liste-multiple libelle="Aucun type selectionne" [items]="g.types" [selection]="g.selection"
                    (changer)="changerGroupe(g.types, $event)" />
                </div>
              }
            </div>
          } @else {
            <mg-liste-multiple libelle="Aucun type selectionne" [items]="types()" [selection]="selection()"
              (changer)="etat.poiSelectionnes.set($event)" />
          }
          @if (cartes().length > 0) {
            <div class="mt-2 flex flex-col gap-1.5">
              @for (c of cartes(); track c.id) {
                <div [attr.data-carte-poi]="c.id"
                  class="flex flex-col gap-[7px] rounded-[4px] border-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)] px-[10px] py-2">
                  <div class="flex items-center justify-between">
                    <span class="text-[12px] font-medium text-primary">{{ c.id }}</span>
                    <button type="button" data-retirer title="Retirer ce POI" (click)="retirer(c.id)"
                      class="cursor-pointer border-0 bg-transparent px-[2px] py-0 font-mono text-[11px] leading-none text-tertiary">✕</button>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="w-[50px] whitespace-nowrap text-[11px] text-tertiary">Épingle</span>
                    <div class="relative flex flex-1 items-center">
                      <select data-taille [attr.aria-label]="'Épingle ' + c.id" (change)="pois.reglerStyle(c.id, { size: $any($event.target).value })"
                        class="w-full flex-1 cursor-pointer appearance-none rounded-[4px] border-fin border-subtle bg-elevated py-1 pl-2 pr-[22px] text-[13px] text-primary outline-none">
                        @for (t of tailles; track t) { <option [value]="t" [selected]="t === c.taille">{{ t }}</option> }
                      </select>
                      <span class="pointer-events-none absolute right-[7px] text-[9px] leading-none text-tertiary">▾</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="w-[50px] whitespace-nowrap text-[11px] text-tertiary">Couleur</span>
                    <div class="relative flex flex-1 items-center">
                      <div class="pointer-events-none absolute left-[7px] z-[1] size-[10px] shrink-0 rounded-full border border-[color-mix(in_srgb,var(--text-primary)_15%,transparent)]"
                        [style.background]="c.couleur"></div>
                      <select data-couleur [attr.aria-label]="'Couleur ' + c.id" (change)="pois.reglerStyle(c.id, { color: $any($event.target).value })"
                        class="w-full flex-1 cursor-pointer appearance-none rounded-[4px] border-fin border-subtle bg-elevated py-1 pl-6 pr-[22px] text-[13px] text-primary outline-none">
                        @for (p of couleurs; track p.hex) { <option [value]="p.hex" [selected]="p.hex === c.couleur">{{ p.label }}</option> }
                      </select>
                      <span class="pointer-events-none absolute right-[7px] text-[9px] leading-none text-tertiary">▾</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        @if (selection().length > 0) {
          <div class="flex gap-1.5">
            <button type="button" data-afficher-poi [disabled]="pois.chargement()" (click)="afficher()"
              class="w-full flex-1 rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
              [class]="pois.chargement() ? desactive : actif">{{ pois.chargement() ? 'CHARGEMENT...' : 'AFFICHER LES POI SUR LA CARTE' }}</button>
            <button type="button" data-densite [attr.aria-pressed]="pois.modeDensite()"
              [title]="pois.modeDensite() ? 'Mode densité activé — cliquer pour repasser en marqueurs' : 'Passer en carte de densité'"
              (click)="pois.modeDensite.set(!pois.modeDensite())"
              class="shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] border-fin px-[10px] py-0 text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
              [class]="pois.modeDensite() ? densiteActive : densiteInactive"
            >{{ pois.modeDensite() ? '◉ Densité' : '◎ Densité' }}</button>
          </div>
        }
        @if (pois.erreur(); as e) {
          <div data-erreur class="mt-1.5 font-mono text-[10px] text-danger">! {{ e }}</div>
        }
      </div>
    }
  `,
})
export class SectionPoiComponent {
  protected readonly etat = inject(EtatCarteService);
  protected readonly pois = inject(PoisService);
  protected readonly catalogue = inject(CataloguePoiService);
  protected readonly selections = inject(SelectionsCalquesService);

  protected readonly aide = AIDE_POI;
  protected readonly tailles = PIN_SIZES;
  protected readonly couleurs = PIN_COLORS;
  /** `primaryBtn(C.green)` (`styles.ts:23-30`), actif puis désactivé. */
  protected readonly actif = 'cursor-pointer border-success text-success bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]';
  protected readonly desactive = 'cursor-not-allowed border-subtle text-tertiary opacity-55 bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]';
  /** Le bouton « Densité » (`PoiSection.tsx:209-221`), actif puis inactif. */
  protected readonly densiteActive = 'border-primary text-primary bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]';
  protected readonly densiteInactive = 'border-subtle text-tertiary bg-elevated';

  protected readonly ouvert = computed(() => this.selections.sections()['poi'] !== false);
  protected readonly selection = this.etat.poiSelectionnes;
  protected readonly types = computed(() => this.catalogue.types().filter((t) => t.id !== 'risque_industriel'));
  /** `null` quand rien ne vient de l'espace : une seule liste, sans sous-titre. */
  protected readonly groupes = computed<readonly GroupePoi[] | null>(() => {
    const types = this.types();
    if (!types.some((t) => t.origine === 'espace')) return null;
    const selection = this.selection();
    return TITRES_GROUPES.map(([origine, titre]) => {
      const siens = types.filter((t) => t.origine === origine);
      const ids = new Set(siens.map((t) => t.id));
      return { origine, titre, types: siens, selection: selection.filter((id) => ids.has(id)) };
    }).filter((g) => g.types.length > 0);
  });
  protected readonly cartes = computed(() => {
    const styles = this.pois.styles();
    return this.selection().map((id) => {
      const s = styles[id] ?? this.pois.styleDe(id);
      return { id, taille: s.size, couleur: s.color };
    });
  });

  constructor() {
    // Le catalogue n'est lu qu'à la première ouverture de la section, une fois par écran.
    effect(() => {
      if (this.ouvert()) this.catalogue.chargerUneFois();
    });
  }

  /**
   * Ce qu'une liste de groupe émet remplace la part de la sélection qui est à ce groupe, et elle seule : l'ordre des
   * types déjà choisis est gardé, les nouveaux s'ajoutent à la fin (cocher bmw puis lycee → `['bmw', 'lycee']`).
   */
  protected changerGroupe(types: readonly TypePoi[], emis: readonly string[]): void {
    const duGroupe = new Set(types.map((t) => t.id));
    const gardes = new Set(emis);
    this.etat.poiSelectionnes.update((avant) => [
      ...avant.filter((id) => !duGroupe.has(id) || gardes.has(id)),
      ...emis.filter((id) => !avant.includes(id)),
    ]);
  }

  protected retirer(id: string): void {
    this.etat.poiSelectionnes.update((l) => l.filter((p) => p !== id));
    this.pois.oublierStyle(id);
  }

  /** `handleSearchPOI` (`PanneauCalques.tsx:272-285`) : régions, départements et ville partent vides, comme React. */
  protected afficher(): void {
    if (this.selection().length === 0 || this.pois.chargement()) return;
    this.pois.chercher({
      poi_types: this.selection(), scope: this.etat.perimetreScope(), regions: [], depts: [], ville: '', rayon_poi: null,
      poi_natures: {},
    });
  }
}
