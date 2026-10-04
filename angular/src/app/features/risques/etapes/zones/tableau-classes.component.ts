import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ClasseJeu } from '../../data/jeux-zones.api';
import { POIDS_MAX, POIDS_MIN } from '../../logique/jeu';
import { libelleClasse } from '../../logique/libelle-classe';
import type { Niveau } from '../../logique/profil';

/** Le message d'un jeu sans classe — MOT POUR MOT de `OngletZones.tsx:474`. */
export const MESSAGE_AUCUNE_CLASSE = 'Ce jeu ne retient aucune classe. Élargissez les anneaux ou le territoire.';

/** La teinte d'une classe, d'après son niveau (`couleurDeClasse`, `OngletZones.tsx:141-145`) — un JETON, jamais un hex. */
export function couleurDeClasse(classe: string): string {
  if (classe === 'hors') return 'var(--donnee-absente)';
  const niveau = classe.split(':')[0];
  return niveau === 'haut' || niveau === 'bas' || niveau === 'autres' ? `var(--niveau-${niveau})` : 'var(--donnee-absente)';
}

/** Une ligne prête à afficher : aucune fonction appelée dans le gabarit. */
interface LigneClasse {
  classe: string;
  libelle: string;
  teinte: string;
  population: string;
  retenus: string;
  touches: string;
  poids: number;
}

const TH = 'px-2 py-1.5 text-[11px] font-normal text-tertiary';
const TD = 'px-2 py-[7px] text-right font-mono text-[12px] text-secondary';

/**
 * Les classes d'un jeu et leurs poids — portage de `TableauClasses` (`OngletZones.tsx:467-539`).
 *
 * Le poids est un multiplicateur d'enchère : il ne change ni la géométrie ni les codes postaux retenus. Il est validé
 * à la SORTIE du champ (`blur`), comme React : un nombre hors des bornes ou illisible n'est pas envoyé.
 */
@Component({
  selector: 'mg-tableau-classes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-4 block' },
  template: `
    @if (lignes().length === 0) {
      <p role="status" class="m-0 rounded-[6px] border-fin border-danger/20 bg-danger/10 px-3 py-2 text-[12px] leading-[1.5] text-danger">{{ messageAucuneClasse }}</p>
    } @else {
      <table class="w-full border-collapse text-[12px]">
        <thead>
          <tr class="border-b-fin border-default">
            <th [class]="th + ' text-left'">Classe</th>
            <th [class]="th + ' text-right'">Population en zone</th>
            <th [class]="th + ' text-right'">Codes postaux retenus</th>
            <th [class]="th + ' text-right'" title="Multiplicateur d’enchère appliqué au plan">Poids</th>
          </tr>
        </thead>
        <tbody>
          @for (l of lignes(); track l.classe) {
            <tr data-role="classe" class="border-b-fin border-subtle">
              <td class="px-2 py-[7px]">
                <span aria-hidden="true" class="mr-2 inline-block size-2 rounded-[2px]" [style.background]="l.teinte"></span>{{ l.libelle }}
              </td>
              <td [class]="td">{{ l.population }}</td>
              <td [class]="td">{{ l.retenus }}<span class="text-tertiary"> / {{ l.touches }}</span></td>
              <td [class]="td + ' w-[90px]'">
                <input type="number" [min]="poidsMin" [max]="poidsMax" step="0.1" [value]="l.poids"
                       (blur)="sortir(l.classe, $event)" [attr.aria-label]="'Poids de ' + l.libelle"
                       class="w-16 rounded-[4px] border-fin border-subtle bg-elevated px-[6px] py-1 text-right font-mono text-[12px] text-primary" />
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="mt-2 mb-0 text-[11px] text-tertiary">
        Le poids est un multiplicateur d’enchère, de {{ poidsMin }} à {{ poidsMax }}. Il ne
        change ni la géométrie ni les codes postaux retenus : il décide de la part de
        budget que chaque classe reçoit.
      </p>
    }
  `,
})
export class TableauClassesComponent {
  readonly classes = input.required<ClasseJeu[]>();
  readonly poids = input.required<Record<string, number>>();
  readonly anneauxPar = input.required<Record<Niveau, number[]>>();
  readonly poidsChange = output<{ classe: string; valeur: number }>();

  protected readonly poidsMin = POIDS_MIN;
  protected readonly poidsMax = POIDS_MAX;
  protected readonly messageAucuneClasse = MESSAGE_AUCUNE_CLASSE;
  protected readonly th = TH;
  protected readonly td = TD;

  protected readonly lignes = computed<LigneClasse[]>(() => this.classes().map((c) => ({
    classe: c.classe,
    libelle: libelleClasse(c.classe, this.anneauxPar()),
    teinte: couleurDeClasse(c.classe),
    population: formaterNombre(Math.round(c.population_en_zone)),
    retenus: formaterNombre(c.n_cp_retenus),
    touches: formaterNombre(c.n_cp),
    poids: this.poids()[c.classe] ?? 1,
  })));

  /**
   * Deux écarts à React, listés au rapport : un champ VIDÉ n'envoie rien (React lisait `Number('')`, soit un poids de
   * 0 posé sans l'avoir tapé), et un poids inchangé n'envoie rien (React rejouait un PATCH à chaque sortie du champ).
   */
  protected sortir(classe: string, ev: Event): void {
    const champ = ev.target as HTMLInputElement;
    const courant = this.poids()[classe] ?? 1;
    const brut = champ.value;
    const v = Number(brut);
    if (brut.trim() === '' || !Number.isFinite(v) || v < POIDS_MIN || v > POIDS_MAX) {
      // Refusé : le champ REVIENT au poids en vigueur. Laisser « 7 » affiché ferait croire à un poids posé, alors que
      // rien n'est parti — et `[value]` ne se réécrit pas tant que le poids d'entrée ne change pas.
      champ.value = String(courant);
      return;
    }
    if (v === courant) return;
    this.poidsChange.emit({ classe, valeur: v });
  }
}
