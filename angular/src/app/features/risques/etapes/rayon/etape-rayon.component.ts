import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import type { ResultatBandes } from '../../etat/donnees-risque.service';
import { LIBELLE_NIVEAU, NIVEAUX, type ProfilRayons, anneauxDuNiveau } from '../../logique/profil';
import { TableauBandesComponent } from './tableau-bandes.component';

/** La commande qui construit le pré-calcul manquant — MOT POUR MOT de `OngletRayons.tsx:114`. */
export const COMMANDE_CONSTRUCTION = 'node scripts/construire_carreau_risque.mjs';

const ENCADRE = 'mb-[14px] rounded-md border-fin px-3 py-[10px]';
const ENCADRE_AVERTISSEMENT = `${ENCADRE} border-[color-mix(in_srgb,var(--warning)_20%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]`;
const ENCADRE_DANGER = `${ENCADRE} border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]`;

/**
 * ② Rayon — la CONSÉQUENCE du profil : combien d'habitants tombent dans chaque bande. Portage de `OngletRayons.tsx`
 * (la courbe de T10 arrive par l'emplacement `[emplacement-courbe]`).
 *
 * ── LES BANDES NE SONT PAS CHARGÉES ICI ──────────────────────────────────
 *
 * Elles viennent de `DonneesRisqueService` (relayées par l'écran) : le même résultat que le bandeau KPI et le tiroir
 * des anneaux. Revenir sur cette étape ne relance rien, et le tableau ne se vide pas le temps d'une réponse — pendant
 * un recalcul, les chiffres précédents restent affichés et s'estompent (`mgPerime`, posé par l'écran).
 *
 * ── LA COURBE ET LE TABLEAU NE PORTENT PAS LES MÊMES NOMBRES ─────────────
 *
 * La courbe est MARGINALE (une par gravité : un carreau proche des deux niveaux y compte deux fois) ; le tableau
 * applique la règle d'affectation unique. L'écran le dit au-dessus de la courbe.
 */
@Component({
  selector: 'mg-etape-rayon',
  imports: [IconeComponent, KpiComponent, TableauBandesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (resultat().etat === 'echec') {
      <div data-role="echec" [class]="encadre()">
        <p class="m-0 text-[12px] leading-[1.5]" [class.text-warning]="resultat().aConstruire"
           [class.text-danger]="!resultat().aConstruire">{{ resultat().erreur }}</p>
        @if (resultat().aConstruire) {
          <p class="mb-0 mt-[6px] text-[11px] text-tertiary">
            Construction : <code class="font-mono">{{ commande }}</code>
          </p>
        }
      </div>
    }

    @if (resultat().etat === 'chargement' && !resultat().bandes) {
      <div class="flex items-center gap-2 text-[12px] text-tertiary">
        <mg-icone nom="chargement" [taille]="14" class="animate-spin" />
        Classement des carreaux…
      </div>
    }

    @if (resultat().bandes; as b) {
      <div class="mb-[18px] flex flex-wrap gap-7">
        <mg-kpi [valeur]="kpis().total" [libelle]="kpis().libelleTotal" note="la somme des bandes égale ce total" />
        @for (k of kpis().niveaux; track k.niveau) {
          <mg-kpi [valeur]="k.valeur" [libelle]="k.libelle" [note]="k.note" />
        }
        <mg-kpi [valeur]="kpis().carreaux" libelle="carreaux classés" [note]="kpis().noteCarreaux" />
      </div>

      <p class="mb-4 mt-0 max-w-[680px] text-[11px] leading-[1.5] text-tertiary">
        Chaque carreau reçoit une seule classe : le seuil haut l’emporte sur le seuil bas, et le périmètre PPRT sur la
        bande calculée. C’est ce qui rend toutes les sommes additives — par niveau, par bande et par territoire.
      </p>

      <mg-tableau-bandes [profil]="profil()" [parClasse]="b.par_classe" [horsZone]="b.hors_zone" [total]="b.total"
                         [libelleCible]="libelleCible()" />

      <div data-role="bloc-courbe" class="mt-7 border-t-fin border-subtle pt-4">
        <p class="mb-[10px] mt-0 max-w-[680px] text-[11px] leading-[1.5] text-tertiary">
          La courbe ci-dessous répond à une autre question : où placer un anneau. Elle est lue par gravité, sans
          priorité entre niveaux — un carreau proche des deux y compte deux fois. Ses chiffres ne s’additionnent donc
          pas à ceux du tableau.
        </p>
        <ng-content select="[emplacement-courbe]" />
      </div>
    }
  `,
})
export class EtapeRayonComponent {
  /** Le profil CALCULÉ (anneaux des seuils décochés vidés), jamais `etat.profil`. */
  readonly profil = input.required<ProfilRayons>();
  readonly resultat = input.required<ResultatBandes>();
  readonly libelleCible = input.required<string>();
  /** Le territoire du fil d'Ariane, « France entière » par défaut. */
  readonly nomPerimetre = input.required<string>();

  protected readonly commande = COMMANDE_CONSTRUCTION;
  protected readonly encadre = computed(() => (this.resultat().aConstruire ? ENCADRE_AVERTISSEMENT : ENCADRE_DANGER));

  /** Les KPI : total, un par niveau qui porte des anneaux (déduit des classes, jamais demandé à part), carreaux. */
  protected readonly kpis = computed(() => {
    const b = this.resultat().bandes;
    const parClasse = b?.par_classe ?? {};
    const niveaux = NIVEAUX
      .filter((niveau) => anneauxDuNiveau(this.profil(), niveau).length > 0)
      .map((niveau) => ({
        niveau,
        valeur: formaterNombre(Object.entries(parClasse)
          .filter(([cle]) => cle.startsWith(`${niveau}:`))
          .reduce((t, [, v]) => t + v, 0)),
        libelle: LIBELLE_NIVEAU[niveau].toLowerCase(),
        note: niveau === 'haut'
          ? 'prioritaire : un carreau proche des deux niveaux compte ici'
          : 'hors des anneaux du seuil haut',
      }));
    return {
      total: formaterNombre(b?.total),
      libelleTotal: this.libelleCible().toLowerCase(),
      niveaux,
      carreaux: formaterNombre(b?.n_carreaux),
      noteCarreaux: `${this.nomPerimetre()}, carroyage INSEE 200 m`,
    };
  });
}
