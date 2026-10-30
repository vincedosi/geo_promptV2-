import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { lireSeuil } from '../../logique/zones/lire-seuil';
import { perimetreDeFiltre } from '../../logique/zones/perimetre-recette';
import {
  INDICATEURS_SEUIL_CARREAUX, MESSAGES_REFUS, MIN_MENAGES_CARREAUX_DEFAUT, MIN_MENAGES_CARREAUX_MAX, type OperateurSeuil, type Recette,
  refusPerimetreLocal,
} from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

/**
 * « Carreaux au-dessus d'un seuil » (lot 3, spec § 16.3) : un indicateur Filosofi 200 m de la liste fermée, un
 * opérateur, un seuil ; la zone est l'union des carreaux retenus DANS le périmètre de ① (sql/255). Un carreau de moins
 * de N ménages (11 par défaut, ③ finitions T6, V-2) est écarté : sous ce seuil l'INSEE impute ses valeurs.
 *
 * Le formulaire ne fait que COMPOSER sa recette et dire sa garde (arbitrage P4) : « Aperçu », le nom et
 * « Enregistrer » sont au pied (`mg-pied-recette`), qui lit `recette()` du formulaire actif. Une recette refusée
 * localement (aucun périmètre, France, région) vaut `null` : le pied ne peut pas la lancer.
 */
@Component({
  selector: 'mg-recette-seuil-carreaux',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-3.5 py-3' },
  template: `
    <h5 class="titre-recette">Carreaux au-dessus d’un seuil</h5>
    <label class="libelle" for="seuil-carreaux-indicateur">Indicateur (carreaux de 200 m)</label>
    <select id="seuil-carreaux-indicateur" data-indicateur class="champ" [value]="indicateur()" (change)="indicateur.set($any($event.target).value)">
      @for (i of indicateurs; track i.id) { <option [value]="i.id" [selected]="i.id === indicateur()">{{ i.libelle }}</option> }
    </select>
    <div class="flex items-center gap-2">
      <select data-operateur aria-label="Opérateur" class="champ w-16" [value]="operateur()" (change)="operateur.set($any($event.target).value)">
        <option value=">=">≥</option><option value="<=">≤</option>
      </select>
      <input data-seuil type="number" aria-label="Seuil" class="champ w-24 font-mono" min="0" [value]="seuilSaisi()" (input)="seuilSaisi.set($any($event.target).value)" />
      <span data-unite class="libelle">{{ unite() }}</span>
    </div>
    <label data-ligne-min-menages class="libelle flex items-center gap-2">
      Carreaux d’au moins
      <input data-min-menages type="number" class="champ w-20 font-mono" min="0" [max]="minMenagesMax" step="1" [value]="minMenagesSaisi()" (input)="minMenagesSaisi.set($any($event.target).value)" />
      ménages
    </label>
    @if (garde(); as g) { <p data-garde class="garde">{{ g }}</p> }
  `,
  styles: [STYLES_RECETTE],
})
export class RecetteSeuilCarreauxComponent {
  private readonly filtre = inject(EtatCarteService).filtre;
  protected readonly indicateurs = INDICATEURS_SEUIL_CARREAUX;
  protected readonly indicateur = signal(INDICATEURS_SEUIL_CARREAUX[0].id);
  protected readonly operateur = signal<OperateurSeuil>('>=');
  /** Le texte du champ, lu AVANT conversion : un champ vide n'est pas 0 (`+''` vaut 0 et passait la garde). */
  protected readonly seuilSaisi = signal('40');
  protected readonly seuil = computed(() => lireSeuil(this.seuilSaisi()));
  protected readonly minMenagesMax = MIN_MENAGES_CARREAUX_MAX;
  /** Le minimum de ménages d'un carreau retenu, lu comme le seuil (un champ vide n'est pas 0). */
  protected readonly minMenagesSaisi = signal(String(MIN_MENAGES_CARREAUX_DEFAUT));
  private readonly minMenages = computed(() => lireSeuil(this.minMenagesSaisi()));
  protected readonly unite = computed(() => INDICATEURS_SEUIL_CARREAUX.find((i) => i.id === this.indicateur())?.unite ?? '');
  private readonly composee = computed<Recette>(() => ({
    v: 1, type: 'seuil_carreaux', indicateur: this.indicateur(), operateur: this.operateur(), seuil: this.seuil(),
    perimetre: perimetreDeFiltre(this.filtre()), min_menages: this.minMenages(),
  }));
  readonly garde = computed(() => {
    const r = refusPerimetreLocal(this.composee());
    if (r) return MESSAGES_REFUS[r];
    if (!(Number.isFinite(this.seuil()) && this.seuil() >= 0)) return 'Saisissez un seuil positif.';
    const m = this.minMenages();
    return Number.isInteger(m) && m >= 0 && m <= MIN_MENAGES_CARREAUX_MAX ? null : `Saisissez un nombre entier de ménages, de 0 à ${formaterNombre(MIN_MENAGES_CARREAUX_MAX)}.`;
  });
  /** La recette prête à lancer, ou `null` tant que la garde refuse. */
  readonly recette = computed<Recette | null>(() => (this.garde() ? null : this.composee()));
}
