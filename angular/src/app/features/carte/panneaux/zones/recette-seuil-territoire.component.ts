import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import { lireSeuil } from '../../logique/zones/lire-seuil';
import { perimetreDeFiltre } from '../../logique/zones/perimetre-recette';
import { MESSAGES_REFUS, type OperateurSeuil, type Recette, refusPerimetreLocal } from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

/** Les indicateurs rangés par famille, dans l'ordre d'arrivée (`optgroup`). */
function parFamille(liste: readonly IndicateurRegistre[]): { famille: string; indicateurs: IndicateurRegistre[] }[] {
  const groupes = new Map<string, IndicateurRegistre[]>();
  for (const i of liste) {
    const f = i.famille ?? 'Autres';
    groupes.set(f, [...(groupes.get(f) ?? []), i]);
  }
  return [...groupes].map(([famille, indicateurs]) => ({ famille, indicateurs }));
}

/**
 * « IRIS ou codes postaux au-dessus d'un seuil » (lot 3, spec § 16.3) : un indicateur du registre (celui du score
 * composite), un opérateur, un seuil ; la zone est l'union des territoires retenus DANS le périmètre de ① (sql/256,
 * 7 000 territoires au plus — la maille, IRIS ou CP, est celle de l'indicateur).
 *
 * Le catalogue est lu UNE fois par ce formulaire (`CatalogueIndicateursService`, fourni par la page carte : la lecture
 * en vol ou déjà faite est partagée), à l'ouverture de « Par seuil » — jamais à l'ouverture de ③. Il ne compose que sa recette et
 * sa garde (P4).
 */
@Component({
  selector: 'mg-recette-seuil-territoire',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-3.5 py-3' },
  template: `
    <h5 class="titre-recette">IRIS ou codes postaux au-dessus d’un seuil</h5>
    <label class="libelle" for="seuil-territoire-indicateur">Indicateur</label>
    <select id="seuil-territoire-indicateur" data-indicateur class="champ" [value]="indicateur()" (change)="indicateur.set($any($event.target).value)">
      @for (g of groupes(); track g.famille) {
        <optgroup [label]="g.famille">
          @for (i of g.indicateurs; track i.indicator_code) {
            <option [value]="i.indicator_code" [selected]="i.indicator_code === indicateur()">{{ i.label }}</option>
          }
        </optgroup>
      }
    </select>
    <div class="flex items-center gap-2">
      <select data-operateur aria-label="Opérateur" class="champ w-16" [value]="operateur()" (change)="operateur.set($any($event.target).value)">
        <option value=">=">≥</option><option value="<=">≤</option>
      </select>
      <input data-seuil type="number" aria-label="Seuil" class="champ w-24 font-mono" [value]="seuilSaisi()" (input)="seuilSaisi.set($any($event.target).value)" />
      <span data-unite class="libelle">{{ unite() }}</span>
    </div>
    @if (garde(); as g) { <p data-garde class="garde">{{ g }}</p> }
  `,
  styles: [STYLES_RECETTE],
})
export class RecetteSeuilTerritoireComponent {
  private readonly filtre = inject(EtatCarteService).filtre;
  private readonly catalogue = signal<readonly IndicateurRegistre[]>([]);
  private readonly etatCatalogue = signal<'lecture' | 'pret' | 'echec'>('lecture');
  protected readonly groupes = computed(() => parFamille(this.catalogue()));
  protected readonly indicateur = linkedSignal<readonly IndicateurRegistre[], string>({
    source: this.catalogue,
    computation: (liste, avant) => (avant && liste.some((i) => i.indicator_code === avant.value) ? avant.value : liste[0]?.indicator_code ?? ''),
  });
  protected readonly operateur = signal<OperateurSeuil>('>=');
  /** Le texte du champ, lu AVANT conversion : un champ vide n'est pas 0 (`+''` vaut 0 et passait la garde). */
  protected readonly seuilSaisi = signal('20');
  protected readonly seuil = computed(() => lireSeuil(this.seuilSaisi()));
  protected readonly unite = computed(() => this.catalogue().find((i) => i.indicator_code === this.indicateur())?.unit ?? '');
  private readonly composee = computed<Recette>(() => ({
    v: 1, type: 'seuil_territoire', indicateur: this.indicateur(), operateur: this.operateur(), seuil: this.seuil(),
    perimetre: perimetreDeFiltre(this.filtre()),
  }));
  readonly garde = computed(() => {
    if (this.etatCatalogue() === 'echec') return 'Indicateurs indisponibles.';
    if (this.etatCatalogue() === 'lecture') return 'Lecture des indicateurs…';
    if (!this.indicateur()) return 'Aucun indicateur disponible.';
    const r = refusPerimetreLocal(this.composee());
    if (r) return MESSAGES_REFUS[r];
    return Number.isFinite(this.seuil()) ? null : 'Saisissez un seuil.';
  });
  readonly recette = computed<Recette | null>(() => (this.garde() ? null : this.composee()));

  constructor() {
    const lecture = inject(CatalogueIndicateursService).charger().subscribe({
      next: (liste) => { this.catalogue.set(liste); this.etatCatalogue.set('pret'); },
      error: () => this.etatCatalogue.set('echec'),
    });
    inject(DestroyRef).onDestroy(() => lecture.unsubscribe());
  }
}
