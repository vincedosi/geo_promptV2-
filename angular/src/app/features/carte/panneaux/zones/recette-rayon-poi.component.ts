import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { perimetreDeFiltre } from '../../logique/zones/perimetre-recette';
import { MESSAGES_REFUS, RAYON_POI_MAX_M, RAYON_POI_MIN_M, type Recette, refusPerimetreLocal } from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

const PAS_RAYON_POI_M = 100;
const RAYON_POI_DEFAUT_M = 5000;

/**
 * « Rayon autour d'un type de POI » (lot 3, spec § 16.3) : tous les POI du type DANS le périmètre de ①, un disque
 * autour de chacun, l'union découpée par le périmètre (L3-1 ; sql/254, 5 000 POI au plus).
 *
 * Les types viennent du catalogue de la PAGE (`CataloguePoiService`, déjà lu par ② : `chargerUneFois` ne relit rien
 * s'il l'a été). Comme les trois autres formulaires, il ne compose que sa recette et sa garde (P4).
 */
@Component({
  selector: 'mg-recette-rayon-poi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-3.5 py-3' },
  template: `
    <h5 class="titre-recette">Rayon autour d’un type de POI</h5>
    <label class="libelle" for="rayon-poi-type">Type de POI</label>
    <select id="rayon-poi-type" data-categorie class="champ" [value]="categorie()" (change)="categorie.set($any($event.target).value)">
      @for (t of types(); track t.id) { <option [value]="t.id" [selected]="t.id === categorie()">{{ t.label }}</option> }
    </select>
    <div class="flex items-center gap-2">
      <input type="range" data-rayon aria-label="Rayon" class="flex-1 accent-[var(--brand-teal)]"
             [min]="min" [max]="max" [step]="pas" [value]="rayonM()" (input)="rayonM.set(+$any($event.target).value)" />
      <span data-rayon-libelle class="w-16 text-right font-mono text-[11px] text-secondary">{{ libelleRayon() }}</span>
    </div>
    @if (garde(); as g) { <p data-garde class="garde">{{ g }}</p> }
  `,
  styles: [STYLES_RECETTE],
})
export class RecetteRayonPoiComponent {
  private readonly catalogue = inject(CataloguePoiService);
  private readonly filtre = inject(EtatCarteService).filtre;
  protected readonly types = this.catalogue.types;
  protected readonly min = RAYON_POI_MIN_M;
  protected readonly max = RAYON_POI_MAX_M;
  protected readonly pas = PAS_RAYON_POI_M;
  /** Le premier type dès que le catalogue arrive ; gardé tant qu'il existe. */
  protected readonly categorie = linkedSignal<readonly { id: string }[], string>({
    source: this.types,
    computation: (types, avant) => (avant && types.some((t) => t.id === avant.value) ? avant.value : types[0]?.id ?? ''),
  });
  protected readonly rayonM = signal(RAYON_POI_DEFAUT_M);
  protected readonly libelleRayon = computed(() => {
    const m = this.rayonM();
    return m >= 1000 ? `${formaterNombre(m / 1000)} km` : `${formaterNombre(m)} m`;
  });
  private readonly composee = computed<Recette>(() => ({
    v: 1, type: 'rayon_poi', categorie: this.categorie(), rayon_m: this.rayonM(), perimetre: perimetreDeFiltre(this.filtre()),
  }));
  readonly garde = computed(() => {
    const r = refusPerimetreLocal(this.composee());
    if (r) return MESSAGES_REFUS[r];
    if (this.categorie()) return null;
    return this.catalogue.chargement() ? 'Lecture des types de POI…' : (this.catalogue.erreur() ?? 'Aucun type de POI disponible.');
  });
  readonly recette = computed<Recette | null>(() => (this.garde() ? null : this.composee()));

  constructor() {
    this.catalogue.chargerUneFois();
  }
}
