import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { type JeuListe, JeuxApi } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import { ouvrirJeuListe } from '../../etat/ouvrir-jeu';
import { messageErreurCouverture } from '../../logique/analyses/couverture-erreurs';
import { PASTILLE, PASTILLE_INACTIVE } from '../analyse/styles-analyse';
import { DialogueSuppressionZoneComponent } from '../zones/dialogue-suppression-zone.component';
import { BADGE_TYPE_JEU, detailJeu } from '../zones/jeux-de-zones.component';

/**
 * ⑤ Jeu de zones — la bibliothèque des jeux de l'espace (lot 5, T12) : les DEUX types, badge neutre « Risque » /
 * « Zone ». Ouvrir suit la règle de « Mes zones » (`ouvrirJeuListe`) : un jeu risque ouvre le module (A-12), un jeu de
 * zone pose `?jeu=`. Supprimer passe par le dialogue de confirmation des zones (`mg-dialogue-suppression-zone`,
 * titre et texte du jeu) ; un jeu ouvert supprimé est fermé, sa zone reste.
 *
 * Lue à la PREMIÈRE ouverture de la section (repliée par défaut), une fois — le panneau reste monté.
 */
@Component({
  selector: 'mg-bibliotheque-jeux',
  imports: [DialogueSuppressionZoneComponent, EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-bibliotheque-jeux': '' },
  template: `
    <mg-entete-section libelle="Bibliothèque des jeux" repliable [ouvert]="ouverte()" (ouvertChange)="basculer($event)" />
    @if (ouverte()) {
      <div class="flex flex-col gap-1.5 px-4 py-3">
        @if (lecture.enCours()) { <div class="font-mono text-[11px] text-tertiary">Lecture des jeux…</div> }
        @if (lecture.erreur(); as e) { <div class="text-[11px] text-danger" role="alert">{{ e }}</div> }
        @if (lecture.resultat() && lignes().length === 0) { <p data-bibliotheque-vide class="m-0 text-[11px] text-tertiary">Aucun jeu enregistré dans cet espace.</p> }
        @for (j of lignes(); track j.id) {
          <div [attr.data-jeu-liste]="j.id" class="flex items-center gap-2 rounded-[6px] border-fin border-subtle px-[10px] py-2">
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] text-primary">{{ j.nom }}<span class="ml-[7px] font-mono text-[10px] text-tertiary">v{{ j.version }}</span>
                <span data-type-jeu class="ml-[7px] rounded-[4px] border-fin border-default bg-overlay px-1.5 py-px text-[10px] text-tertiary">{{ j.badge }}</span></span>
              <span class="mt-0.5 block font-mono text-[10px] text-tertiary">{{ j.detail }}</span>
            </span>
            <button type="button" data-ouvrir-jeu (click)="ouvrir(j.jeu)" [class]="pastille">{{ j.jeu.type === 'risque' ? 'Ouvrir dans le module' : 'Ouvrir' }}</button>
            <button type="button" data-supprimer-jeu (click)="aSupprimer.set(j.jeu)" [class]="pastille">Supprimer</button>
          </div>
        }
      </div>
    }
    @if (aSupprimer(); as j) {
      <mg-dialogue-suppression-zone titre="Supprimer le jeu de zones" [nom]="j.nom" texte="Cette action est irréversible. Ses extractions sont supprimées avec lui ; la zone, elle, reste."
        [confirmer]="confirmer" (fermer)="aSupprimer.set(null)" />
    }
  `,
})
export class BibliothequeJeuxComponent {
  private readonly api = inject(JeuxApi);
  private readonly jeu = inject(JeuZonesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly pastille = `${PASTILLE} ${PASTILLE_INACTIVE}`;
  protected readonly ouverte = signal(false);
  protected readonly lecture = new LectureAnnulable<JeuListe[]>(messageErreurCouverture);
  protected readonly aSupprimer = signal<JeuListe | null>(null);
  protected readonly lignes = computed(() => (this.lecture.resultat() ?? []).map((j) => ({
    id: j.id, nom: j.nom, version: j.version, badge: BADGE_TYPE_JEU[j.type], detail: detailJeu(j), jeu: j,
  })));

  protected basculer(ouverte: boolean): void {
    this.ouverte.set(ouverte);
    if (ouverte) this.lecture.chargerUneFois(() => this.api.lister().pipe(map((r) => (Array.isArray(r?.jeux) ? r.jeux : []))));
  }

  protected ouvrir(j: JeuListe): void {
    void ouvrirJeuListe(this.router, this.route, j);
  }

  /** La suppression du dialogue : `null` si elle a réussi (le dialogue se ferme), le message sinon. */
  protected readonly confirmer = async (): Promise<string | null> => {
    const j = this.aSupprimer();
    if (!j) return null;
    try {
      await firstValueFrom(this.api.supprimer(j.id));
    } catch (e) {
      return messageErreurCouverture(e);
    }
    this.lecture.resultat.update((l) => (l ?? []).filter((x) => x.id !== j.id));
    // Le jeu ouvert vient d'être supprimé : il se ferme, sa zone reste à convertir.
    if (this.jeu.jeuId() === j.id) this.jeu.choisirZone(this.jeu.zoneId(), this.jeu.recette());
    this.aSupprimer.set(null);
    return null;
  };
}
