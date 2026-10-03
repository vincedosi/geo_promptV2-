import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HORS_ZONE, classesDuProfil } from '../logique/affectation';
import { LIBELLE_NIVEAU, NIVEAUX, type ProfilRayons, anneauxDuNiveau, libelleRayon } from '../logique/profil';

/**
 * Le résumé du profil de rayons dans l'en-tête, en chips cliquables — portage de `ResumeProfil.tsx`.
 *
 * Le profil décide de la classe de chaque carreau, donc de TOUS les chiffres de l'écran : deux captures du
 * même territoire prises avec deux profils seraient sinon indiscernables. Cliquer une chip DÉPLIE le tiroir
 * des anneaux (`etat.atelier`) : le résumé est aussi le chemin de retour vers le réglage.
 *
 * Un niveau sans anneau n'apparaît pas : une chip vide se lirait « aucun habitant à ce niveau », alors
 * qu'elle signifie « ce niveau n'est pas calculé ».
 */
@Component({
  selector: 'mg-resume-profil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lignes().length === 0) {
      <span class="text-[11px] text-warning">Aucun anneau réglé : aucune population n’est classée.</span>
    } @else {
      <div class="flex flex-wrap items-center gap-[6px]">
        @for (l of lignes(); track l.niveau) {
          <button type="button" (click)="ouvrirAtelier.emit()" [attr.title]="l.titre"
                  class="inline-flex cursor-pointer items-center gap-[6px] rounded-md border-fin border-default bg-overlay px-2 py-[2px] text-[11px] text-secondary">
            <span>{{ l.libelle }}</span>
            <span class="font-mono text-primary">{{ l.anneaux }}</span>
          </button>
        }
        @if (profil().lie) {
          <span title="Tous les niveaux partagent les mêmes anneaux." class="text-[11px] text-teal">liés</span>
        }
        <span [attr.title]="profil().inclurePPRT
                ? 'Les périmètres PPRT publiés par l’État forment une classe à part, avant toute bande.'
                : 'Les périmètres PPRT ne sont pas distingués : chaque carreau prend sa bande calculée.'"
              class="font-mono text-[11px] text-tertiary">{{ profil().inclurePPRT ? 'PPRT à part' : 'PPRT fondus' }} · {{ nClasses() }} classes</span>
      </div>
    }
  `,
})
export class ResumeProfilComponent {
  readonly profil = input.required<ProfilRayons>();
  /** Ramène au tiroir des anneaux. */
  readonly ouvrirAtelier = output<void>();

  protected readonly lignes = computed(() => {
    const p = this.profil();
    return NIVEAUX
      .map((niveau) => ({ niveau, anneaux: anneauxDuNiveau(p, niveau) }))
      .filter(({ anneaux }) => anneaux.length > 0)
      .map(({ niveau, anneaux }) => ({
        niveau,
        libelle: LIBELLE_NIVEAU[niveau],
        anneaux: anneaux.map(libelleRayon).join(' · '),
        titre: `Régler les anneaux de ${LIBELLE_NIVEAU[niveau].toLowerCase()}`,
      }));
  });

  /** Le hors-zone n'est pas un réglage : on ne compte que les classes réglées. */
  protected readonly nClasses = computed(() => classesDuProfil(this.profil()).filter((c) => c !== HORS_ZONE).length);
}
