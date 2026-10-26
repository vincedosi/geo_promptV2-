import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PoisService } from '../../couches/pois.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { PIN_COLORS, PIN_SIZES } from '../../logique/constantes-calques';
import { corpsPoisDuFiltre, scopeDuFiltre } from '../../logique/perimetre-national';

/** L'aide de l'ancien en-tête POI (`TOOLTIPS.poi`, `FilterSectionHeader.tsx:21`), gardée en infobulle du titre. */
export const AIDE_POI = "Point d'Intérêt — commerce, service, lieu public";

/**
 * Ce que ② fait des types de POI cochés — la section « Points d'intérêt (POI) » de l'ancien panneau Calques
 * (`section-poi.component.ts`, portage de `filter-panel/PoiSection.tsx`), SANS ses listes de types : depuis T13, chaque
 * type est une ligne de ② (`mg-ligne-jeu`, mode case) rangée par origine et par sélection recommandée.
 *
 * Repris tels quels : la ligne « Points d'intérêt — n sélectionné(s) » et « ↻ » (`?refresh=1`), l'erreur du catalogue
 * et son « réessayer », une carte de style par type choisi (épingle, couleur, croix qui retire le type ET son épingle),
 * « Afficher les POI sur la carte » (un geste explicite, arbitrage A12 ; CTA teal, plus vert) et « Densité », l'erreur de recherche. Le corps
 * de la recherche suit le filtre de ① (écart à React depuis le 26/10, voir `afficher`).
 *
 * Écart, ruling AT-5 : les libellés du bouton passent en sentence case (« Afficher les POI sur la carte »,
 * « Chargement... » ; React écrivait « AFFICHER LES POI SUR LA CARTE »). Écarts de couleur de `section-poi` gardés :
 * les blancs translucides de React deviennent `--text-primary` au même pourcentage, jamais une couleur en dur.
 *
 * Le catalogue n'est PAS lu ici : le panneau Données le lit à sa construction (`chargerUneFois`).
 */
@Component({
  selector: 'mg-actions-poi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-[14px] py-[10px]' },
  template: `
    <div class="flex items-center justify-between text-[11px] font-medium text-secondary">
      <span data-titre-poi [title]="aide">Points d'intérêt@if (selection().length > 0) {<span class="text-secondary"> — {{ selection().length }} sélectionné{{ selection().length > 1 ? 's' : '' }}</span>}</span>
      <button type="button" data-rafraichir title="Rafraîchir la liste" aria-label="Rafraîchir la liste des types de POI" (click)="catalogue.charger(true)"
        class="cursor-pointer border-0 bg-transparent px-[2px] py-0 text-[11px] leading-none text-tertiary">{{ catalogue.chargement() ? '…' : '↻' }}</button>
    </div>
    @if (catalogue.erreur() && catalogue.types().length === 0) {
      <div data-erreur-catalogue class="font-mono text-[10px] text-danger">
        ! Erreur chargement catégories : {{ catalogue.erreur() }} — <button type="button" (click)="catalogue.charger(true)"
          class="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-warning">réessayer</button>
      </div>
    }
    @if (cartes().length > 0) {
      <div class="flex flex-col gap-1.5">
        @for (c of cartes(); track c.id) {
          <div [attr.data-carte-poi]="c.id"
            class="flex flex-col gap-[7px] rounded-[4px] border-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)] px-[10px] py-2">
            <div class="flex items-center justify-between">
              <span data-nom-type class="text-[12px] font-medium text-primary">{{ c.nom }}</span>
              <button type="button" data-retirer title="Retirer ce POI" (click)="retirer(c.id)"
                class="cursor-pointer border-0 bg-transparent px-[2px] py-0 font-mono text-[11px] leading-none text-tertiary">✕</button>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-[50px] whitespace-nowrap text-[11px] text-tertiary">Épingle</span>
              <div class="relative flex flex-1 items-center">
                <select data-taille [attr.aria-label]="'Épingle ' + c.nom" (change)="pois.reglerStyle(c.id, { size: $any($event.target).value })"
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
                <select data-couleur [attr.aria-label]="'Couleur ' + c.nom" (change)="pois.reglerStyle(c.id, { color: $any($event.target).value })"
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

    @if (selection().length > 0) {
      <div class="flex gap-1.5">
        <button type="button" data-afficher-poi [disabled]="pois.chargement()" (click)="afficher()"
          class="w-full flex-1 rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
          [class]="pois.chargement() ? desactive : actif">{{ pois.chargement() ? 'Chargement...' : 'Afficher les POI sur la carte' }}</button>
        <button type="button" data-densite [attr.aria-pressed]="pois.modeDensite()"
          [title]="pois.modeDensite() ? 'Mode densité activé — cliquer pour repasser en marqueurs' : 'Passer en carte de densité'"
          (click)="pois.modeDensite.set(!pois.modeDensite())"
          class="shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] border-fin px-[10px] py-0 text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
          [class]="pois.modeDensite() ? densiteActive : densiteInactive"
        >{{ pois.modeDensite() ? '◉ Densité' : '◎ Densité' }}</button>
      </div>
    }
    @if (pois.erreur(); as e) {
      <div data-erreur class="font-mono text-[10px] text-danger">! {{ e }}</div>
    }
  `,
})
export class ActionsPoiComponent {
  protected readonly etat = inject(EtatCarteService);
  protected readonly pois = inject(PoisService);
  protected readonly catalogue = inject(CataloguePoiService);

  protected readonly aide = AIDE_POI;
  protected readonly tailles = PIN_SIZES;
  protected readonly couleurs = PIN_COLORS;
  /**
   * CTA métier teal (DESIGN_SYSTEM § 5, « afficher, charger, appliquer »), actif puis désactivé. Écart à React
   * (`primaryBtn(C.green)`) corrigé à la relecture T13 : le vert est réservé au statut système.
   */
  protected readonly actif = 'cursor-pointer border-teal text-teal bg-transparent font-medium hover:bg-teal-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]';
  protected readonly desactive = 'cursor-not-allowed border-subtle text-tertiary opacity-55 bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]';
  /** Le bouton « Densité » (`PoiSection.tsx:209-221`), actif puis inactif. */
  protected readonly densiteActive = 'border-primary text-primary bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]';
  protected readonly densiteInactive = 'border-subtle text-tertiary bg-elevated';

  protected readonly selection = this.etat.poiSelectionnes;
  protected readonly cartes = computed(() => {
    const styles = this.pois.styles();
    // Le titre d'une carte est le LIBELLÉ du type (« Tous les lycées »), comme sa ligne ; l'identifiant tant que le
    // catalogue n'est pas lu (relecture T13 : React titrait l'identifiant brut).
    const libelles = new Map(this.catalogue.types().map((t) => [t.id, t.label]));
    return this.selection().map((id) => {
      const s = styles[id] ?? this.pois.styleDe(id);
      return { id, nom: libelles.get(id) ?? id, taille: s.size, couleur: s.color };
    });
  });

  protected retirer(id: string): void {
    this.etat.poiSelectionnes.update((l) => l.filter((p) => p !== id));
    this.pois.oublierStyle(id);
  }

  /**
   * `handleSearchPOI` (`PanneauCalques.tsx:272-285`). ÉCART À REACT (retours du 26/10, T3, retour 5) : React envoie
   * régions, départements et ville VIDES, et tous les CIRFA de métropole s'affichaient sur une région choisie. Ici, le
   * territoire vient du filtre (`corpsPoisDuFiltre` : région, département, commune, code postal) et la portée de la
   * métropole ou de la France entière aussi (`scopeDuFiltre`) ; une zone garde sa bbox (`PoisService.chercher`).
   */
  protected afficher(): void {
    if (this.selection().length === 0 || this.pois.chargement()) return;
    const filtre = this.etat.filtre();
    this.pois.chercher({
      poi_types: this.selection(), ...corpsPoisDuFiltre(filtre), scope: scopeDuFiltre(filtre, this.etat.perimetreScope()),
      rayon_poi: null, poi_natures: {},
    });
  }
}
