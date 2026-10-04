import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { JeuResume } from '../../data/jeux-zones.api';
import type { EtatAtelier } from '../../etat/atelier-jeux.service';

/** Les textes de la bibliothèque, MOT POUR MOT de `OngletZones.tsx:662-680`. */
export const TEXTES_BIBLIOTHEQUE = {
  lecture: 'Lecture de la bibliothèque…',
  echec: 'La bibliothèque des jeux de zones est indisponible.',
  vide: 'Aucun jeu enregistré. Construisez-en un ci-dessus, donnez-lui un nom, et il '
    + 'apparaîtra ici — prêt à devenir le plan d’une campagne.',
} as const;

interface LigneJeu {
  id: string;
  nom: string;
  version: string;
  resume: string;
}

const BOUTON_ICONE = 'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-fin border-subtle bg-transparent';

/** Les jeux enregistrés de l'organisation — portage de `Bibliotheque` (`OngletZones.tsx:654-730`). */
@Component({
  selector: 'mg-bibliotheque',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (etat()) {
      @case ('chargement') {
        <div class="flex items-center gap-2 px-[2px] py-[10px]">
          <mg-icone nom="chargement" [taille]="13" class="animate-spin text-teal" />
          <span class="text-[12px] text-tertiary">{{ textes.lecture }}</span>
        </div>
      }
      @case ('echec') {
        <p role="status" class="m-0 rounded-[6px] border-fin border-danger/20 bg-danger/10 px-3 py-2 text-[12px] leading-[1.5] text-danger">{{ textes.echec }}</p>
      }
      @default {
        @if (lignes().length === 0) {
          <p class="m-0 text-[12px] text-tertiary">{{ textes.vide }}</p>
        } @else {
          <ul class="m-0 flex list-none flex-col gap-[6px] p-0">
            @for (j of lignes(); track j.id) {
              <li data-role="jeu" class="flex items-center gap-3 rounded-[8px] border-fin px-3 py-[9px]"
                  [class.bg-teal-10]="j.id === ouvert()" [class.border-teal]="j.id === ouvert()"
                  [class.bg-elevated]="j.id !== ouvert()" [class.border-subtle]="j.id !== ouvert()">
                <mg-icone nom="calques" [taille]="14" class="shrink-0 text-tertiary" />
                <div class="min-w-0 flex-1">
                  <div class="text-[12px] text-primary">
                    {{ j.nom }}<span class="ml-2 font-mono text-[10.5px] text-tertiary">{{ j.version }}</span>
                  </div>
                  <div data-role="resume" class="mt-[2px] font-mono text-[10.5px] text-tertiary">{{ j.resume }}</div>
                </div>
                <button type="button" (click)="ouvrir.emit(j.id)" title="Ouvrir ce jeu dans l’atelier"
                        aria-label="Ouvrir ce jeu dans l’atelier" [class]="boutonIcone + ' text-secondary'">
                  <mg-icone nom="dossier-ouvert" [taille]="13" />
                </button>
                <button type="button" (click)="supprimer.emit(j.id)" [disabled]="enCoursId() === j.id"
                        title="Supprimer ce jeu" aria-label="Supprimer ce jeu" [class]="boutonIcone + ' text-danger'">
                  @if (enCoursId() === j.id) {
                    <mg-icone nom="chargement" [taille]="13" class="animate-spin" />
                  } @else {
                    <mg-icone nom="corbeille" [taille]="13" />
                  }
                </button>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class BibliothequeComponent {
  readonly jeux = input.required<JeuResume[]>();
  readonly etat = input.required<EtatAtelier>();
  readonly ouvert = input<string | null>(null);
  readonly enCoursId = input<string | null>(null);
  readonly ouvrir = output<string>();
  readonly supprimer = output<string>();

  protected readonly textes = TEXTES_BIBLIOTHEQUE;
  protected readonly boutonIcone = BOUTON_ICONE;

  /** « 1 006 codes postaux · 81,6 % d’utile · seuil 35 % » (`OngletZones.tsx:701-705`). */
  protected readonly lignes = computed<LigneJeu[]>(() => this.jeux().map((j) => ({
    id: j.id,
    nom: j.nom,
    version: `v${j.version}`,
    resume: `${j.n_cp_retenus === null ? '—' : formaterNombre(j.n_cp_retenus)} codes postaux`
      + (j.taux_utile !== null ? ` · ${formaterDecimal(Number(j.taux_utile))} % d’utile` : '')
      + ` · seuil ${Number(j.seuil_couverture_cp)} %`,
  })));
}
