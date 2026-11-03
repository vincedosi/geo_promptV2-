import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { Cellule, EnteteCellule } from '../../../../ui/tableau/cellules';
import { classePart } from '../../couches/couche-couverture';
import {
  type CleTriCouverture, type Decoupage, type LigneCouverture, type SensTri, pageDeLignes, trierLignes,
} from '../../logique/analyses/couverture';
import { PASTILLE, PASTILLE_INACTIVE } from './styles-analyse';

/** Une ligne du tableau, déjà mise en forme. */
interface LigneAffichee {
  code: string;
  nom: string;
  commune: string | null;
  /**
   * D36 (relecture du lot 4) : une unité à population inconnue (DROM non carroyé) — « Population inconnue (non
   * carroyée) · 62,0 % de sa surface du référentiel dans la zone » ; `null` pour une ligne ordinaire.
   */
  inconnue: string | null;
  dansZone: string;
  total: string;
  part: string;
  /** Largeur de la barre (0-100) et son palier `--seq-*` ; `null` sans dénominateur. */
  barre: { largeur: number; couleur: string } | null;
}

const COLONNES: ReadonlyArray<{ cle: CleTriCouverture; libelle: string; gauche?: true; explication?: string }> = [
  { cle: 'code', libelle: 'Territoire', gauche: true },
  { cle: 'pop_en_zone', libelle: 'Dans la zone', explication: 'Habitants carroyés du territoire dont le carreau a son centre dans la zone.' },
  { cle: 'pop_totale', libelle: 'Total', explication: 'Tous les habitants carroyés du territoire.' },
  { cle: 'part', libelle: 'Part', explication: 'Dans la zone ÷ total : la part du territoire que la zone couvre.' },
];

/** Les cinq paliers de part en CSS (HTML : `var()` y est permis), les mêmes jetons que la couche MapLibre. */
export const PALIERS_CSS = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'] as const;

/** Le tri par défaut : la plus grande population dans la zone d'abord (l'ordre de la réponse). */
const TRI_DEFAUT = { cle: 'pop_en_zone' as CleTriCouverture, sens: 'desc' as SensTri };

/**
 * ④ Analyse — le tableau de la couverture d'une zone par CP ou par IRIS (lot 4, T8). Même grammaire que le tableau de
 * l'étape Couverture du module risque (`mg-tableau-couverture` : `th[mgTh]`/`td[mgTd]`, code en mono atténué devant le
 * nom, chiffres en JetBrains Mono, survol qui se lit sur la carte) ; la part porte une barre fine dans la rampe
 * séquentielle `--seq-1…5` de la carte.
 *
 * Tri par colonne (clic sur l'en-tête : décroissant, puis croissant), 50 lignes par page. Rien n'est tronqué sans le
 * dire : « 5 498 IRIS · page 3 sur 110 ». Une nouvelle liste remet le tri et la page à leurs défauts.
 */
@Component({
  selector: 'mg-tableau-couverture-zone',
  imports: [Cellule, EnteteCellule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <table class="w-full border-collapse text-[12px]" data-tableau-couverture>
      <thead>
        <tr class="border-b-fin border-default">
          @for (c of colonnes; track c.cle) {
            <th mgTh [alignement]="c.gauche ? 'gauche' : 'droite'" [explication]="c.explication"
                [attr.aria-sort]="tri().cle === c.cle ? (tri().sens === 'asc' ? 'ascending' : 'descending') : 'none'">
              <button type="button" [attr.data-tri]="c.cle" (click)="trier(c.cle)"
                      class="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[10px] text-tertiary hover:text-primary"
                      [class.text-primary]="tri().cle === c.cle">
                {{ c.cle === 'code' ? libelleTerritoire() : c.libelle }}@if (tri().cle === c.cle) { {{ tri().sens === 'asc' ? '▲' : '▼' }} }
              </button>
            </th>
          }
        </tr>
      </thead>
      <tbody>
        @for (l of page().lignes; track l.code) {
          <tr class="border-b-fin border-subtle transition-[background-color] duration-150 ease-[var(--ease-out)]"
              [class.bg-teal-10]="actif() === l.code" [attr.data-ligne]="l.code"
              tabindex="0" [attr.aria-label]="l.code + ' ' + l.nom + ' : ' + l.part"
              (mouseenter)="survol.emit(l.code)" (mouseleave)="survol.emit(null)" (focus)="survol.emit(l.code)" (blur)="survol.emit(null)">
            <td class="px-2 py-[7px] text-primary">
              <span class="mr-[7px] font-mono text-[10px] text-tertiary">{{ l.code }}</span>{{ l.nom }}
              @if (l.commune) { <span class="block text-[10px] text-tertiary">{{ l.commune }}</span> }
              @if (l.inconnue) { <span class="block text-[10px] text-tertiary" data-inconnue>{{ l.inconnue }}</span> }
            </td>
            <td mgTd fort>{{ l.dansZone }}</td>
            <td mgTd>{{ l.total }}</td>
            <td mgTd>
              <span class="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                @if (l.barre; as b) {
                  <!-- Piste bordée (relecture T8, I2) : le palier --seq-1 est plus clair que --bg-overlay en thème clair. -->
                  <span aria-hidden="true" class="inline-block h-1.5 w-10 overflow-hidden rounded-[2px] border-fin border-[var(--text-tertiary)]">
                    <span class="block h-full" [style.width.%]="b.largeur" [style.background]="b.couleur"></span>
                  </span>
                }
                {{ l.part }}
              </span>
            </td>
          </tr>
        }
      </tbody>
    </table>

    <div class="mt-2 flex items-center gap-2" data-pagination>
      <span class="flex-1 font-mono text-[10px] text-tertiary" data-compte>{{ compte() }}</span>
      @if (page().nPages > 1) {
        <button type="button" data-precedentes [disabled]="page().page <= 1" (click)="numero.set(page().page - 1)"
                [class]="boutonPage">Précédentes</button>
        <button type="button" data-suivantes [disabled]="page().page >= page().nPages" (click)="numero.set(page().page + 1)"
                [class]="boutonPage">Suivantes</button>
      }
    </div>
  `,
})
export class TableauCouvertureZoneComponent {
  readonly lignes = input.required<readonly LigneCouverture[]>();
  readonly decoupage = input.required<Decoupage>();
  /** D36 : la surface d'une unité à population inconnue (`surface_inconnues` de la réponse, « surface du référentiel »). */
  readonly surfaceInconnues = input<string | null | undefined>(null);
  /** Le territoire survolé (tableau ou carte). */
  readonly actif = input<string | null>(null);
  readonly survol = output<string | null>();

  protected readonly colonnes = COLONNES;
  protected readonly boutonPage = `${PASTILLE} ${PASTILLE_INACTIVE} disabled:cursor-not-allowed disabled:opacity-40`;

  protected readonly tri = linkedSignal({ source: this.lignes, computation: () => ({ ...TRI_DEFAUT }) });
  protected readonly numero = linkedSignal({ source: this.lignes, computation: () => 1 });
  /** La colonne « Territoire » trie par CODE. */
  private readonly triees = computed(() => trierLignes(this.lignes(), this.tri().cle, this.tri().sens));
  protected readonly page = computed(() => {
    const p = pageDeLignes(this.triees(), this.numero());
    const surface = this.surfaceInconnues() ?? null;
    return { ...p, lignes: p.lignes.map((l) => versAffichee(l, surface)) };
  });
  protected readonly libelleTerritoire = computed(() => (this.decoupage() === 'iris' ? 'IRIS' : 'Code postal'));
  protected readonly compte = computed(() => {
    const n = this.lignes().length;
    const unite = this.decoupage() === 'iris' ? 'IRIS' : n > 1 ? 'codes postaux' : 'code postal';
    const p = this.page();
    return p.nPages > 1 ? `${formaterNombre(n)} ${unite} · page ${p.page} sur ${p.nPages}` : `${formaterNombre(n)} ${unite}`;
  });

  /** Une colonne déjà triée change de sens ; une autre part en décroissant (le libellé, en croissant). */
  protected trier(cle: CleTriCouverture): void {
    const t = this.tri();
    this.tri.set(t.cle === cle ? { cle, sens: t.sens === 'asc' ? 'desc' : 'asc' } : { cle, sens: cle === 'code' ? 'asc' : 'desc' });
    this.numero.set(1);
  }
}

function versAffichee(l: LigneCouverture, surface: string | null): LigneAffichee {
  const k = classePart(l.part);
  const inconnue = l.pop_en_zone === null
    ? 'Population inconnue (non carroyée)' + (l.part_surface === undefined ? ''
      : ` · ${formaterDecimal(l.part_surface * 100, 1)} % de sa ${surface ?? 'surface'} dans la zone`)
    : null;
  return {
    code: l.code,
    nom: l.nom ?? '',
    commune: l.commune,
    inconnue,
    dansZone: formaterNombre(l.pop_en_zone),
    total: formaterNombre(l.pop_totale),
    part: l.part === null ? '—' : `${formaterDecimal(l.part, 1)} %`,
    barre: k === null || l.part === null ? null : { largeur: Math.min(100, Math.max(0, l.part)), couleur: PALIERS_CSS[k] },
  };
}
