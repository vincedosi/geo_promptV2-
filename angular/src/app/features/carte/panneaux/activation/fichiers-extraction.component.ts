import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { BoutonExportComponent } from '../../../risques/exports/bouton-export.component';
import { ActivationApi } from '../../data/activation.api';
import type { FormatFichier } from '../../logique/activation/cartes';
import { libelleBloc, libelleFormat, nomRepliFichier } from '../../logique/activation/fichiers';
import type { Maille, Plateforme } from '../../logique/jeu/plateformes';

/** Le badge d'une règle de plateforme marquée `a_verifier` dans le registre (son en-tête de fichier le dit aussi). */
export const LIBELLE_A_VERIFIER = 'à vérifier';

/**
 * Les fichiers d'UNE plateforme pour une extraction figée (lot 7, T5, A-6, A-14) : un bouton par format offert.
 * Monté dans les cartes de ⑦ ET dans la liste des extractions de ⑤ — il ne dépend d'aucune campagne (Q-4).
 *
 * Chaque fichier passe par `mg-bouton-export` (jeton, limiteur, message `error` de la route en cas d'échec), jamais par
 * un `<a href>`. Les `formats` sont fournis par l'appelant (`CarteActivation.formats` en ⑦, `formatsDe` en ⑤) : un
 * jeu risque côté Meta n'en reçoit aucun (ruling 4), et ce composant n'affiche alors rien.
 *
 * Entrées préfixées (`jeuFichier`, …) : aucune ne masque un attribut natif.
 */
@Component({
  selector: 'mg-fichiers-extraction',
  imports: [BoutonExportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-center gap-2', '[attr.data-fichiers-extraction]': 'plateformeFichier()' },
  template: `
    @for (b of boutons(); track b.cle) {
      <mg-bouton-export [attr.data-format]="b.format" [attr.data-bloc]="b.bloc" variante="neutre" [libelle]="b.libelle" [charger]="b.charger" [nomRepli]="b.nom" />
    }
    @if (aVerifier() && boutons().length) {
      <span data-a-verifier title="La règle de cette plateforme est à revérifier : l’en-tête du fichier le dit aussi."
            class="rounded-[4px] border-fin border-warning bg-overlay px-2 py-0.5 text-[10px] text-primary">{{ libelleAVerifier }}</span>
    }
  `,
})
export class FichiersExtractionComponent {
  private readonly api = inject(ActivationApi);

  readonly jeuFichier = input.required<string>();
  readonly versionFichier = input.required<number>();
  readonly plateformeFichier = input.required<Plateforme>();
  readonly mailleFichier = input.required<Maille>();
  readonly formats = input.required<readonly FormatFichier[]>();
  readonly aVerifier = input(false, { transform: booleanAttribute });
  /**
   * B14 round 1 (I-2) : les blocs du découpage figé (`ResumeExtraction.decoupage.blocs`, ARB-6) — un bouton par format
   * ET par bloc, jamais un fichier au-dessus de la limite ; vide sans découpage (un bouton par format, comme avant).
   */
  readonly blocsFichier = input<readonly { numero: number; n_unites: number }[]>([]);

  protected readonly libelleAVerifier = LIBELLE_A_VERIFIER;

  protected readonly boutons = computed(() => {
    const jeu = this.jeuFichier();
    const version = this.versionFichier();
    const plateforme = this.plateformeFichier();
    const blocs = this.blocsFichier();
    return this.formats().flatMap((format): { cle: string; format: FormatFichier; bloc: number | null; libelle: string; nom: string; charger: () => ReturnType<ActivationApi['fichier']> }[] => {
      const libelle = libelleFormat(format, this.mailleFichier());
      if (!blocs.length) {
        return [{ cle: format, format, bloc: null, libelle, nom: nomRepliFichier(version, plateforme, format), charger: () => this.api.fichier(jeu, version, plateforme, format) }];
      }
      return blocs.map((b) => ({
        cle: `${format}-${b.numero}`, format, bloc: b.numero, libelle: libelleBloc(libelle, b),
        nom: nomRepliFichier(version, plateforme, format, b.numero), charger: () => this.api.fichier(jeu, version, plateforme, format, b.numero),
      }));
    });
  });
}
