import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { BoutonExportComponent } from '../../../risques/exports/bouton-export.component';
import { ActivationApi } from '../../data/activation.api';
import type { FormatFichier } from '../../logique/activation/cartes';
import { libelleFormat, nomRepliFichier } from '../../logique/activation/fichiers';
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
    @for (b of boutons(); track b.format) {
      <mg-bouton-export [attr.data-format]="b.format" variante="neutre" [libelle]="b.libelle" [charger]="b.charger" [nomRepli]="b.nom" />
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

  protected readonly libelleAVerifier = LIBELLE_A_VERIFIER;

  protected readonly boutons = computed(() => {
    const jeu = this.jeuFichier();
    const version = this.versionFichier();
    const plateforme = this.plateformeFichier();
    return this.formats().map((format) => ({
      format,
      libelle: libelleFormat(format, this.mailleFichier()),
      nom: nomRepliFichier(version, plateforme, format),
      charger: () => this.api.fichier(jeu, version, plateforme, format),
    }));
  });
}
