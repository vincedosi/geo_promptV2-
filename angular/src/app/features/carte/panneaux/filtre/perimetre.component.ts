import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { DepartementRef, RegionRef } from '../../etat/referentiel-geo.service';
import { type ElementListe, ListeMultipleComponent } from './liste-multiple.component';

/** Périmètre global (pastilles Métro / +DROM). */
export type PerimetreScope = 'metro' | 'all' | null;
/** Sections repliables du widget, dans l'ordre (`use-filter-sections.ts`). */
export type SectionPerimetre = 'perimetre' | 'regions' | 'departements' | 'recherche';

/**
 * En-tête de section repliable — portage de `FilterSectionHeader.tsx` (sans l'infobulle ni le surlignage de
 * recherche : le panneau Filtre n'en passe aucun). Bandeau collant, débordant de 16 px de chaque côté pour
 * couvrir le retrait de son conteneur (`margin: 0 -16px`).
 */
@Component({
  selector: 'mg-entete-filtre',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'button',
    tabindex: '0',
    '[attr.aria-expanded]': 'ouvert()',
    '(click)': 'basculer.emit()',
    '(keydown.enter)': 'basculer.emit()',
    '(keydown.space)': '$event.preventDefault(); basculer.emit()',
    class: 'sticky top-0 z-10 mx-[-16px] flex cursor-pointer select-none items-center gap-2 border-t border-subtle bg-elevated px-[14px] py-[10px]',
  },
  template: `
    <span class="flex-1 text-[12px] font-medium text-primary">{{ libelle() }}</span>
    @if (compte() > 0) {
      <span
        data-compte
        class="rounded-[4px] bg-[color-mix(in_srgb,var(--brand-teal)_15%,transparent)] px-1.5 py-px font-mono text-[10px] leading-[1.4] text-teal"
      >{{ compte() }}</span>
    }
    <mg-icone
      nom="chevron-bas"
      [taille]="14"
      class="shrink-0 text-tertiary transition-transform duration-200 ease-[var(--ease-out)]"
      [style.transform]="ouvert() ? 'rotate(0deg)' : 'rotate(-90deg)'"
    />
  `,
})
export class EnteteFiltreComponent {
  readonly libelle = input.required<string>();
  readonly ouvert = input.required<boolean>();
  readonly compte = input(0);
  readonly basculer = output<void>();
}

/**
 * Les sections « Périmètre » du panneau Filtre — portage de `filter-panel/PerimeterSections.tsx`, rendu en mode
 * overlay (`isOverlayMode` : ni en-tête de catégorie ni repli du groupe). Présentationnel : l'état et la
 * composition du filtre vivent dans `mg-panneau-filtre` ; ce composant affiche et relaie les gestes.
 *
 * Ordre fixe, celui de React : périmètre global, régions, départements, recherche locale, puis le résumé du
 * territoire. Le masque « afficher uniquement le territoire » n'est PAS rendu : React le désactive dans ce
 * panneau (`adminScale={null}`, `PanneauFiltre.tsx:310-313`).
 */
@Component({
  selector: 'mg-perimetre-filtre',
  imports: [EnteteFiltreComponent, ListeMultipleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .apparition { animation: fadeIn 200ms var(--ease-out); }
  `,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-4 p-4">
      <!-- Périmètre global -->
      <div>
        <mg-entete-filtre libelle="Périmètre global" [ouvert]="sections().perimetre" [compte]="scope() ? 1 : 0" (basculer)="basculerSection.emit('perimetre')" />
        @if (sections().perimetre) {
          <div class="apparition mb-3 transition-opacity duration-150 ease-[var(--ease-hover)]">
            <div class="flex gap-1.5">
              <button type="button" data-scope="metro" [attr.aria-pressed]="scope() === 'metro'" (click)="choisirScope.emit('metro')"
                class="flex-1 shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-center text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
                [class]="scope() === 'metro' ? classePillActive : classePillInactive">France Metro</button>
              <button type="button" data-scope="all" [attr.aria-pressed]="scope() === 'all'" (click)="choisirScope.emit('all')"
                class="flex-1 shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-center text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
                [class]="scope() === 'all' ? classePillActive : classePillInactive">France + DROM</button>
            </div>
          </div>
        }
      </div>

      <!-- Régions -->
      <div>
        <mg-entete-filtre libelle="Régions" [ouvert]="sections().regions" [compte]="regionsChoisies().length" (basculer)="basculerSection.emit('regions')" />
        @if (sections().regions) {
          <div class="apparition mb-3">
            <div class="mb-1.5 flex justify-end">
              <button type="button" data-tout-regions (click)="toutesRegions.emit()"
                class="cursor-pointer border-0 bg-transparent p-0 text-[11px]"
                [class.text-danger]="toutesChoisies()"
                [class.text-secondary]="!toutesChoisies()">{{ toutesChoisies() ? 'Tout désélectionner' : 'Tout sélectionner' }}</button>
            </div>
            <mg-liste-multiple
              data-liste="regions"
              [libelle]="libelleRegions()"
              [items]="itemsRegions()"
              [selection]="regionsChoisies()"
              (changer)="changerRegions.emit($event)"
            />
          </div>
        }
      </div>

      <!-- Départements -->
      <div>
        <mg-entete-filtre libelle="Départements" [ouvert]="sections().departements" [compte]="deptsChoisis().length" (basculer)="basculerSection.emit('departements')" />
        @if (sections().departements) {
          <div class="apparition mb-3">
            <mg-liste-multiple
              data-liste="departements"
              [libelle]="libelleDepts()"
              [items]="itemsDepts()"
              [selection]="deptsChoisis()"
              [recherchable]="true"
              (changer)="changerDepts.emit($event)"
            />
            @if (regionsChoisies().length === 0) {
              <div class="mt-1 font-mono text-[9px] italic text-tertiary">Filtrer d'abord par région</div>
            }
          </div>
        }
      </div>

      <!-- Recherche locale -->
      <div>
        <mg-entete-filtre libelle="Recherche locale" [ouvert]="sections().recherche" [compte]="(ville() ? 1 : 0) + (codePostal() ? 1 : 0)" (basculer)="basculerSection.emit('recherche')" />
        @if (sections().recherche) {
          <div class="apparition mb-3">
            <div class="flex gap-2">
              <div class="flex-1">
                <div class="mb-1 text-[11px] font-medium text-secondary">Ville</div>
                <input data-champ="ville" placeholder="ex: Brest" [value]="ville()" (input)="saisirVille.emit($any($event.target).value)"
                  [class]="classeChamp" />
              </div>
              <div class="w-20">
                <div class="mb-1 text-[11px] font-medium text-secondary">Code postal</div>
                <input data-champ="cp" placeholder="29200" maxlength="5" [value]="codePostal()" (input)="saisirCodePostal.emit($any($event.target).value)"
                  [class]="classeChamp" />
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Résumé du territoire -->
      @if (aTerritoire()) {
        <div data-territoire class="text-[16px] leading-[1.5] rounded-[4px] border-fin border-[color-mix(in_srgb,var(--success)_20%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-[10px]">
          <div class="mb-1 text-[11px] font-medium text-success">Territoire sélectionné</div>
          <div class="text-[13px] leading-[1.4] text-primary">{{ territoire() }}</div>
          <button type="button" data-reinitialiser (click)="reinitialiser.emit()"
            class="mt-2 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-tertiary">✕ Réinitialiser</button>
        </div>
      }
    </div>
  `,
})
export class PerimetreComponent {
  readonly sections = input.required<Record<SectionPerimetre, boolean>>();
  readonly scope = input.required<PerimetreScope>();
  readonly regions = input.required<readonly RegionRef[]>();
  readonly regionsChoisies = input.required<readonly string[]>();
  readonly departements = input.required<readonly DepartementRef[]>();
  readonly deptsChoisis = input.required<readonly string[]>();
  readonly ville = input.required<string>();
  readonly codePostal = input.required<string>();
  readonly territoire = input.required<string>();
  readonly aTerritoire = input.required<boolean>();
  /** Le référentiel n'a pas répondu (défaut React corrigé : il affichait « Chargement… » sans fin). */
  readonly erreurReferentiel = input<string | null>(null);

  readonly basculerSection = output<SectionPerimetre>();
  readonly choisirScope = output<'metro' | 'all'>();
  readonly changerRegions = output<string[]>();
  readonly toutesRegions = output<void>();
  readonly changerDepts = output<string[]>();
  readonly saisirVille = output<string>();
  readonly saisirCodePostal = output<string>();
  readonly reinitialiser = output<void>();

  // `pill(active, C.green)` de React (`styles.ts:10-15`) : `hexToRgb('var(--success)')` n'est pas un hex, il retombe
  // sur `240,240,240` — le fond actif est donc un gris clair à 12 % et NON le vert. Reproduit tel quel.
  protected readonly classePillActive = 'bg-[rgba(240,240,240,0.12)] border-success text-success';
  protected readonly classePillInactive = 'bg-elevated border-subtle text-tertiary';
  // `inputStyle` + `inputFocusHandlers` (`styles.ts:31-41`) : bordure teal à 50 % au focus, plus l'anneau de focus global (comme React).
  protected readonly classeChamp =
    'w-full rounded-[4px] border-fin border-subtle bg-elevated px-[10px] py-[7px] text-[13px] text-primary outline-none transition-[border-color] duration-300 ease-[var(--ease-out)] focus:border-[var(--brand-teal-50)]';

  protected readonly toutesChoisies = computed(() => {
    const n = this.regions().length;
    return n > 0 && this.regionsChoisies().length === n;
  });
  protected readonly itemsRegions = computed<ElementListe[]>(() =>
    this.regions().map((r) => ({ id: r.code_region, label: r.nom_region })),
  );
  protected readonly itemsDepts = computed<ElementListe[]>(() =>
    this.departements().map((d) => ({ id: d.code_dept, label: `${d.code_dept} — ${d.nom_dept}` })),
  );
  protected readonly libelleRegions = computed(() =>
    this.regions().length === 0 ? (this.erreurReferentiel() ?? 'Chargement…') : 'Toutes les régions',
  );
  protected readonly libelleDepts = computed(() =>
    this.departements().length === 0 ? (this.erreurReferentiel() ?? 'Chargement…') : 'Tous les départements',
  );
}
