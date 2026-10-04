import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { Cellule, EnteteCellule } from '../../../../ui/tableau/cellules';
import type { UniteBandes } from '../../data/profil-risque.api';
import type { ResultatBandes } from '../../etat/donnees-risque.service';
import { type Dimension, LIBELLE_DIMENSION } from '../../logique/dimensions';
import { anneauxParNiveau, libelleClasse } from '../../logique/libelle-classe';
import type { ProfilRayons } from '../../logique/profil';
import { COMMANDE_CONSTRUCTION } from '../rayon/etape-rayon.component';

/** Une unité du tableau, déjà mise en forme. */
interface Ligne {
  code: string;
  /** Le nom tel que le référentiel l'écrit ; vide si le code est inconnu (la ligne garde sa population). */
  nom: string;
  /** Le nom, ou le code à défaut : c'est ce que disent les infobulles et le fil d'exploration. */
  nomOuCode: string;
  total: string;
  part: string;
  densite: string;
}

/**
 * Part de la population de l'unité qui est exposée (`TableauCouverture.tsx:97-100`).
 * ⚠ `null` et non 0 quand le dénominateur manque : 0 % se lirait « personne n'est exposé ici ».
 */
function part(u: UniteBandes): number | null {
  if (u.pop_totale === null || u.pop_totale <= 0) return null;
  return Math.round((u.total / u.pop_totale) * 1000) / 10;
}

/** Habitants exposés au kilomètre carré de l'unité. Même règle sur le `null` (l.103-106). */
function densite(u: UniteBandes): number | null {
  if (u.surface_km2 === null || u.surface_km2 <= 0) return null;
  return Math.round(u.total / u.surface_km2);
}

/** La flèche de navigation d'une ligne (`styleFleche`, l.49-56) : désactivée, elle reste VISIBLE et garde sa place. */
const FLECHE = 'inline-flex size-4 items-center justify-center rounded-[3px] border-0 bg-transparent p-0 align-middle';

/**
 * ③ Couverture — la population exposée, listée à la maille choisie. Portage de `TableauCouverture.tsx`.
 *
 * Il lit `population_par_classe`, le MÊME moteur que le tableau des bandes de ② : un carreau INSEE de 200 m
 * appartient à UNE unité et à UNE classe, d'où une colonne population additive (à l'arrondi près, voir la note du
 * premier KPI). La part et la densité manquent au code postal, à dessein : le seul référentiel de population à
 * cette maille surcompte de 10,5 %.
 *
 * ── TROIS GESTES DISTINCTS ────────────────────────────────────────────────
 *
 * Le clic sur la LIGNE sélectionne (la mini-carte se cadre, T12) ; la flèche DROITE descend ; la flèche GAUCHE
 * remonte. Confondre clic et descente rendait impossible de simplement REGARDER une unité. Le composant ne fait que
 * relayer : l'exploration vit dans `DonneesRisqueService`, et aucun de ces gestes ne touche au filtre Territoire.
 *
 * Les cellules sont `th[mgTh]` / `td[mgTd]`, portages exacts des `Th`/`Td` d'`elements.tsx` que React emploie ici.
 */
@Component({
  selector: 'mg-tableau-couverture',
  imports: [Cellule, EnteteCellule, IconeComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (resultat().etat === 'chargement' && !resultat().bandes) {
      <div data-role="chargement" class="flex items-center gap-2 text-[12px] text-tertiary">
        <mg-icone nom="chargement" [taille]="14" class="animate-spin" />
        Calcul en cours…
      </div>
    } @else if (resultat().etat === 'echec') {
      <div data-role="echec" class="text-[12px] leading-[1.6]">
        <p class="m-0 text-danger">{{ resultat().erreur ?? 'Calcul indisponible.' }}</p>
        <!-- « Pré-calcul absent » (à lancer) n'est pas « territoire non carroyé » (aucun script n'y changera rien). -->
        @if (resultat().aConstruire) {
          <p class="mb-0 mt-2 font-mono text-[11px] text-tertiary">{{ commande }}</p>
        }
      </div>
    } @else if (resultat().bandes; as b) {
      <div class="mb-4 flex flex-wrap gap-7">
        <mg-kpi accent [valeur]="kpis().total" [libelle]="kpis().libelleTotal"
                note="les lignes se répartissent ce total, à l'arrondi près" />
        <mg-kpi [valeur]="kpis().unites" [libelle]="kpis().libelleUnites"
                note="unités portant au moins un habitant exposé" />
        <mg-kpi [valeur]="kpis().carreaux" libelle="carreaux retenus" note="un carreau de 200 m, une seule classe" />
      </div>

      <!-- La ventilation par classe EN TÊTE : invariante à la maille, elle dit de quoi le total est fait. -->
      @if (classes().length > 0) {
        <div data-role="classes" class="mb-4 flex flex-wrap gap-[6px]">
          @for (c of classes(); track c.cle) {
            <span class="rounded-[4px] border-fin border-subtle bg-overlay px-[9px] py-[3px] text-[11px] text-secondary">
              {{ c.libelle }}<span class="ml-[7px] font-mono text-primary">{{ c.valeur }}</span>
            </span>
          }
        </div>
      }

      <table class="w-full border-collapse text-[12px]">
        <thead>
          <tr class="border-b-fin border-default">
            <th mgTh alignement="gauche">{{ libelleMaille() }}</th>
            <th mgTh>{{ libelleCible() }}</th>
            <th mgTh [explication]="titrePart()">Part</th>
            <th mgTh [explication]="titreDensite()">Densité</th>
          </tr>
        </thead>
        <tbody>
          @for (u of lignes(); track u.code) {
            <tr class="cursor-pointer border-b-fin border-subtle transition-[background-color] duration-150 ease-[var(--ease-out)]"
                [class.bg-teal-10]="actif() === u.code" [attr.title]="'Cadrer la carte sur ' + u.nomOuCode"
                [attr.data-unite]="u.code"
                (mouseenter)="survol.emit(u.code)" (mouseleave)="survol.emit(null)" (click)="selection.emit(u.code)">
              <td class="px-2 py-[7px] text-primary">
                <!-- Avant le libellé pour REMONTER, après pour DESCENDRE ; grisées et non masquées aux extrémités. -->
                <button type="button" data-role="remonter" [class]="classeRemonter()" [disabled]="!remontable()"
                        [attr.aria-label]="remontable() ? 'Remonter d’un niveau' : 'Déjà au niveau le plus large'"
                        [attr.title]="remontable() ? 'Remonter d’un niveau' : null"
                        (click)="$event.stopPropagation(); remonter.emit()">
                  <mg-icone nom="chevron-gauche" [taille]="12" />
                </button>
                <span class="mr-[7px] font-mono text-[10px] text-tertiary">{{ u.code }}</span>{{ u.nom }}
                <button type="button" data-role="descendre" [class]="classeDescendre()" [disabled]="!descendable()"
                        [attr.aria-label]="descendable() ? 'Descendre dans ' + u.nomOuCode : 'Dernier niveau — pas de découpage plus fin'"
                        [attr.title]="descendable() ? 'Descendre dans ' + u.nomOuCode : null"
                        (click)="$event.stopPropagation(); descendre.emit({ code: u.code, nom: u.nomOuCode })">
                  <mg-icone nom="chevron-droite" [taille]="12" />
                </button>
              </td>
              <td mgTd fort>{{ u.total }}</td>
              <td mgTd>{{ u.part }}</td>
              <td mgTd>{{ u.densite }}</td>
            </tr>
          }
        </tbody>
      </table>

      @if (lignes().length === 0) {
        <p data-role="vide" class="mb-0 mt-[10px] text-[12px] text-tertiary">Aucune population exposée pour ces filtres.</p>
      }

      @if (b.tronquee) {
        <p data-role="tronquee" class="mb-0 mt-[10px] text-[11px] text-warning">
          Liste tronquée : {{ kpis().unites }} unités exposées, les plus peuplées seulement sont affichées. Le total
          ci-dessus les compte toutes.
        </p>
      }

      <!-- \`hors_zone\` : des habitants PROCHES d'un site que le profil ne retient pas, pas la France non exposée. -->
      <p data-role="note" class="mb-0 mt-[14px] text-[11px] leading-[1.5] text-tertiary">
        Un carreau INSEE de 200 m appartient à une seule unité et à une seule classe : la somme de la colonne
        population <strong class="font-medium">égale</strong> le total, à n’importe quelle maille.
        {{ horsZone() }} habitants vivent à moins de 10 km d’un site sans être retenus par les anneaux de ce profil —
        ce n’est pas la population non exposée de France.@if (maille() === 'code_postal') { Ni part ni densité à cette
        maille : le seul référentiel de population par code postal surcompte de 10,5 %.}
      </p>
    }
  `,
})
export class TableauCouvertureComponent {
  readonly resultat = input.required<ResultatBandes>();
  /** La maille LISTÉE — celle du tableau exploré, pas forcément celle de la barre. */
  readonly maille = input.required<Dimension>();
  /** Le profil calculé, pour nommer les bandes de chaque classe. */
  readonly profil = input.required<ProfilRayons>();
  readonly libelleCible = input.required<string>();
  /** Peut-on descendre d'un cran depuis cette maille ? */
  readonly descendable = input.required<boolean>();
  /** Est-on descendu, donc peut-on remonter ? */
  readonly remontable = input.required<boolean>();
  /** Code de l'unité survolée (tableau ou mini-carte). */
  readonly actif = input<string | null>(null);

  readonly descendre = output<{ code: string; nom: string }>();
  readonly remonter = output<void>();
  /** Clic sur une ligne : la carte se recadre, le tableau ne bouge pas. */
  readonly selection = output<string>();
  readonly survol = output<string | null>();

  protected readonly commande = COMMANDE_CONSTRUCTION;
  private readonly anneaux = computed(() => anneauxParNiveau(this.profil()));
  protected readonly libelleMaille = computed(() => LIBELLE_DIMENSION[this.maille()]);

  protected readonly kpis = computed(() => {
    const b = this.resultat().bandes;
    return {
      total: formaterNombre(b?.total),
      libelleTotal: this.libelleCible().toLowerCase(),
      unites: formaterNombre(b?.n_unites),
      // Tel quel, accord compris : « régions exposés », comme React (l.187).
      libelleUnites: `${this.libelleMaille().toLowerCase()}s exposés`,
      carreaux: formaterNombre(b?.n_carreaux),
    };
  });

  /** Les classes, de la plus peuplée à la moins peuplée (l.148-149). */
  protected readonly classes = computed(() => Object.entries(this.resultat().bandes?.par_classe ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([cle, v]) => ({ cle, libelle: libelleClasse(cle, this.anneaux()), valeur: formaterNombre(v) })));

  protected readonly lignes = computed<Ligne[]>(() => (this.resultat().bandes?.unites ?? []).map((u) => {
    const p = part(u);
    const d = densite(u);
    return {
      code: u.unite,
      nom: u.nom ?? '',
      nomOuCode: u.nom ?? u.unite,
      total: formaterNombre(u.total),
      part: p !== null ? `${formaterNombre(p)} %` : '—',
      densite: d !== null ? formaterNombre(d) : '—',
    };
  }));

  protected readonly horsZone = computed(() => formaterNombre(this.resultat().bandes?.hors_zone));

  protected readonly titrePart = computed(() => (this.maille() === 'code_postal'
    ? 'Indisponible au code postal : le seul référentiel de population à cette maille surcompte de 10,5 %.'
    : 'Part de la population de l’unité qui vit dans une zone du profil.'));
  protected readonly titreDensite = computed(() => (this.maille() === 'code_postal'
    ? 'Indisponible au code postal, même raison que la part.'
    : 'Habitants exposés par kilomètre carré de l’unité.'));

  protected readonly classeRemonter = computed(() => `${FLECHE} mr-1 ${etatFleche(this.remontable())}`);
  protected readonly classeDescendre = computed(() => `${FLECHE} ml-[6px] mr-0 ${etatFleche(this.descendable())}`);
}

/** Couleur et curseur d'une flèche : `--text-secondary` active, `--border-default` grisée (l.53-54). */
function etatFleche(actif: boolean): string {
  return actif ? 'cursor-pointer text-secondary' : 'cursor-default text-[var(--border-default)]';
}
