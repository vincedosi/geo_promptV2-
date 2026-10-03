import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import {
  LIBELLE_NIVEAU, NIVEAUX, type Niveau, type ProfilRayons, anneauxDuNiveau, libelleRayon,
} from '../../logique/profil';

/** Une ligne du tableau : libellé, étendue, population et cumul, déjà formatés. */
interface Ligne {
  cle: string;
  libelle: string;
  /** L'étendue de la bande, en clair (« servitude publiée » pour un périmètre). */
  etendue: string;
  pop: string;
  cumul: string;
  /** Une servitude de l'État, par opposition à un rayon que nous avons choisi. */
  publie: boolean;
  /** Le trait de la ligne, en jetons : plein pour une servitude publiée, tiretés pour une bande calculée. */
  trait: string;
}

const TRAIT_PUBLIE = 'border-solid border-[var(--text-secondary)]';
const TRAIT_CALCULE = 'border-dashed border-[var(--text-tertiary)]';

/**
 * Les lignes d'un niveau, du cœur vers l'extérieur, et leur total (`TableauBandes.tsx:53-88`).
 *
 * Le cumul se calcule ICI, par addition des bandes précédentes — jamais servi par le serveur : la somme est exacte
 * par construction (l'arrondi a eu lieu au grain le plus fin, côté base), et un cumul transporté pourrait dériver de
 * ses composantes sans qu'on le voie.
 */
function lignesDuNiveau(profil: ProfilRayons, niveau: Niveau, parClasse: Record<string, number>): { lignes: Ligne[]; total: number } {
  const anneaux = anneauxDuNiveau(profil, niveau);
  if (anneaux.length === 0) return { lignes: [], total: 0 };
  const lignes: Ligne[] = [];
  let cumul = 0;
  if (profil.inclurePPRT) {
    const pop = parClasse[`${niveau}:pprt`] ?? 0;
    cumul += pop;
    lignes.push({
      cle: `${niveau}:pprt`, libelle: 'Périmètre PPRT', etendue: 'servitude publiée',
      pop: formaterNombre(pop), cumul: formaterNombre(cumul), publie: true, trait: TRAIT_PUBLIE,
    });
  }
  anneaux.forEach((r, i) => {
    const pop = parClasse[`${niveau}:${i + 1}`] ?? 0;
    cumul += pop;
    const debut = i === 0 ? '0' : libelleRayon(anneaux[i - 1]);
    lignes.push({
      cle: `${niveau}:${i + 1}`, libelle: `Bande ${i + 1}`, etendue: `${debut} à ${libelleRayon(r)}`,
      pop: formaterNombre(pop), cumul: formaterNombre(cumul), publie: false, trait: TRAIT_CALCULE,
    });
  });
  return { lignes, total: cumul };
}

/**
 * Le tableau des bandes : population dans chaque bande, et cumulée — portage de `TableauBandes.tsx`.
 *
 * Chaque carreau porte UNE classe (le seuil haut l'emporte sur le seuil bas, le PPRT sur la bande) : le cumul est une
 * simple somme, et la somme des bandes égale le total EXACTEMENT. ⚠ Ce n'est pas la règle du tableau de ③, où les
 * UNITÉS se répartissent le total « à l'arrondi près » : ici rien n'est réarrondi entre la base et l'écran.
 *
 * Les cellules sont celles de `TableauBandes.tsx` (Th 11 px, Td 12 px, filet sous chaque ligne), et NON
 * `th[mgTh]` / `td[mgTd]` du catalogue : React n'utilise pas ici les cellules génériques d'`elements.tsx`, et les
 * prendre changerait tailles, marges et police des libellés (parité de rendu).
 */
@Component({
  selector: 'mg-tableau-bandes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (niveaux().length === 0) {
      <p class="m-0 text-[12px] text-warning">
        Aucun anneau n’est réglé : aucune population n’est classée. Ajoutez un anneau à un niveau pour voir apparaître
        des bandes.
      </p>
    } @else {
      <div class="flex flex-col gap-4">
        @for (n of niveaux(); track n.niveau) {
          <div [attr.data-niveau]="n.niveau">
            <div data-role="entete-niveau" class="mb-[6px] flex items-baseline gap-2">
              <span class="text-[12px] font-medium text-primary">{{ n.libelle }}</span>
              <span class="font-mono text-[11px] text-tertiary">{{ n.total }}</span>
            </div>
            <table class="w-full border-collapse">
              <thead>
                <tr>
                  <th class="border-b-fin border-subtle px-2 pb-[6px] pt-1 text-left text-[11px] font-normal text-tertiary">Bande</th>
                  <th class="border-b-fin border-subtle px-2 pb-[6px] pt-1 text-left text-[11px] font-normal text-tertiary">Étendue</th>
                  <th class="border-b-fin border-subtle px-2 pb-[6px] pt-1 text-right text-[11px] font-normal text-tertiary">{{ libelleCible() }}</th>
                  <th class="border-b-fin border-subtle px-2 pb-[6px] pt-1 text-right text-[11px] font-normal text-tertiary">Cumulée</th>
                </tr>
              </thead>
              <tbody>
                @for (l of n.lignes; track l.cle) {
                  <tr>
                    <td class="border-b-fin border-subtle px-2 py-[5px] text-left text-[12px] text-secondary">
                      <span class="inline-flex items-center gap-[6px]">
                        <!-- Tiret = zone CALCULÉE, trait plein = servitude publiée : la convention de la carte. -->
                        <span aria-hidden="true" data-role="trait" class="h-0 w-[12px] border-t-2" [class]="l.trait"></span>
                        {{ l.libelle }}
                      </span>
                    </td>
                    <td class="border-b-fin border-subtle px-2 py-[5px] text-left text-[12px] text-tertiary">{{ l.etendue }}</td>
                    <td class="border-b-fin border-subtle px-2 py-[5px] text-right font-mono text-[12px] text-secondary">{{ l.pop }}</td>
                    <td class="border-b-fin border-subtle px-2 py-[5px] text-right font-mono text-[12px] text-tertiary">{{ l.cumul }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="flex flex-col gap-1 border-t-fin border-subtle pt-[10px]">
          <div data-role="total" class="flex justify-between gap-3">
            <span class="text-[12px] text-primary">Total, tous niveaux</span>
            <span class="font-mono text-[12px] text-primary">{{ totalFormate() }}</span>
          </div>
          <p class="m-0 text-[11px] leading-[1.5] text-tertiary">
            Chaque carreau ne compte qu’une fois : le seuil haut l’emporte sur le seuil bas. La somme des bandes égale
            donc ce total, exactement.
          </p>
          @if (horsZone() > 0) {
            <p data-role="hors-zone" class="mb-0 mt-1 text-[11px] leading-[1.5] text-tertiary">
              <span class="font-mono">{{ horsZoneFormate() }}</span> habitants vivent à moins de 10 km d’un site sans
              être retenus par ces anneaux. Élargir un rayon les fera entrer. Ce n’est pas la population non exposée de
              France : le calcul ne porte que sur le voisinage des sites.
            </p>
          }
        </div>
      </div>
    }
  `,
})
export class TableauBandesComponent {
  readonly profil = input.required<ProfilRayons>();
  readonly parClasse = input.required<Record<string, number>>();
  readonly horsZone = input.required<number>();
  readonly total = input.required<number>();
  readonly libelleCible = input.required<string>();

  protected readonly niveaux = computed(() => NIVEAUX
    .map((niveau) => {
      const { lignes, total } = lignesDuNiveau(this.profil(), niveau, this.parClasse());
      return { niveau, libelle: LIBELLE_NIVEAU[niveau], lignes, total: formaterNombre(total) };
    })
    .filter((n) => n.lignes.length > 0));

  protected readonly totalFormate = computed(() => formaterNombre(this.total()));
  protected readonly horsZoneFormate = computed(() => formaterNombre(this.horsZone()));
}
