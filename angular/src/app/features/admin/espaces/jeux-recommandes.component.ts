import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { type JeuRecommandable, LIBELLE_NATURE } from '../../carte/logique/jeux-carte';
import { EspacesApi } from './data/espaces.api';
import { messageErreur } from './logique/libelles';

/**
 * Le serveur a lu les types de POI du socle en partie seulement (`socleIncomplet`) : la liste affichée n'est pas sûre,
 * et la renvoyer en PUT effacerait en silence les `poi:` déjà recommandés (relecture T10, mineur 1). On ne la montre
 * donc pas ; seul « Réessayer » est offert.
 */
const SOCLE_INCOMPLET =
  'Les types de POI des données communes n’ont pas pu être lus en entier : enregistrer maintenant effacerait ceux déjà '
  + 'recommandés. Réessayez dans un instant.';

/**
 * « Sélection recommandée sur la carte » (spec carte-en-parcours § 7.2, arbitrage A11) : sous le tableau des jeux de
 * l'onglet Données, parce que celui-ci liste des SOURCES importées, alors qu'une recommandation porte sur un jeu de la
 * CARTE (référentiel ou type de POI du socle).
 *
 * - `espaceId` réactif : chaque changement abandonne la lecture en vol et relit `GET admin/espaces/:id/jeux-recommandes`.
 * - Aucune écriture optimiste : `PUT` de la liste cochée, dans l'ordre de la liste ; succès → notification et
 *   relecture ; échec → notification du message serveur, cases laissées telles quelles.
 * - Lecture dégradée (`socleIncomplet`) : état d'erreur, aucun moyen d'enregistrer.
 */
@Component({
  selector: 'mg-jeux-recommandes',
  imports: [Cellule, EnteteCellule, EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-entete-section libelle="Sélection recommandée sur la carte" class="rounded-t-lg" />
    <p class="intro">Les jeux cochés s’affichent d’abord dans « Données communes » à l’étape ② ; les autres se rangent dans
      « Plus de données communes ». Une recommandation range : elle ne donne ni ne retire aucun droit. Aucune case cochée :
      l’espace voit tout, déplié.</p>
    @if (erreur(); as m) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ m }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (jeux() === null) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else {
      <div class="cadre">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="border-b-fin border-default">
              <th mgTh alignement="gauche">Jeu</th>
              <th mgTh alignement="gauche">Nature</th>
              <th mgTh alignement="gauche">Maille</th>
              <th mgTh>Recommandé</th>
            </tr>
          </thead>
          <tbody>
            @for (j of jeux(); track j.cle) {
              <tr class="border-b-fin border-subtle" [attr.data-jeu-recommandable]="j.cle">
                <td mgTd alignement="gauche" fort class="!font-sans !text-[12px]">{{ j.nom }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ nature[j.nature] }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ j.maille }}</td>
                <td mgTd>
                  <input type="checkbox" class="case" [checked]="cochees().has(j.cle)" [disabled]="ecriture()"
                         [attr.aria-label]="'Recommander ' + j.nom" (change)="basculer(j.cle)" />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button type="button" data-annuler class="bouton-neutre" [disabled]="!modifie() || ecriture()" (click)="annuler()">Annuler les changements</button>
        <button type="button" data-enregistrer class="bouton-teal" [disabled]="!modifie() || ecriture()" (click)="enregistrer()">Enregistrer la sélection</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; margin-top: 24px; font-family: var(--font-sans); }
    .intro { margin: 0 0 10px; padding: 10px 14px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .cadre { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow-x: auto; }
    .case { accent-color: var(--brand-teal); cursor: pointer; }
    .case:disabled { cursor: not-allowed; }
    .case:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .bouton-neutre, .bouton-teal {
      border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .bouton-neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .bouton-teal:not(:disabled):hover { background: var(--brand-teal-10); }
    .bouton-neutre:disabled, .bouton-teal:disabled { opacity: 0.5; cursor: not-allowed; }
    .bouton-neutre:focus-visible, .bouton-teal:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 32px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
})
export class JeuxRecommandesComponent {
  private readonly api = inject(EspacesApi);
  private readonly notifications = inject(NotificationsService);

  readonly espaceId = input.required<string>();

  protected readonly nature = LIBELLE_NATURE;
  /** `null` tant que la lecture n'a pas répondu. */
  protected readonly jeux = signal<JeuRecommandable[] | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly ecriture = signal(false);
  /** La sélection telle que lue : « Annuler les changements » y revient. */
  private readonly lues = signal<ReadonlySet<string>>(new Set());
  protected readonly cochees = signal<ReadonlySet<string>>(new Set());
  protected readonly modifie = computed(() => {
    const a = this.lues();
    const b = this.cochees();
    return a.size !== b.size || [...b].some((c) => !a.has(c));
  });

  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;

  constructor() {
    // Lecture à chaque changement d'espace (input réactif) ; la lecture elle-même hors suivi.
    effect(() => {
      this.espaceId();
      // Une écriture en vol n'est PAS annulée : elle a pu partir ; sa notification dit vrai pour l'espace précédent.
      untracked(() => this.lire());
    });
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.envoi?.unsubscribe();
    });
  }

  protected lire(): void {
    this.lecture?.unsubscribe();
    this.jeux.set(null);
    this.erreur.set(null);
    this.lecture = this.api.jeuxRecommandables(this.espaceId()).subscribe({
      next: (r) => {
        if (r?.socleIncomplet) {
          this.erreur.set(SOCLE_INCOMPLET);
          return;
        }
        const jeux = Array.isArray(r?.jeux) ? r.jeux : [];
        const cochees = new Set(jeux.filter((j) => j.recommande).map((j) => j.cle));
        this.jeux.set(jeux);
        this.lues.set(cochees);
        this.cochees.set(cochees);
      },
      error: (e: unknown) => this.erreur.set(messageErreur(e)),
    });
  }

  protected basculer(cle: string): void {
    this.cochees.update((s) => {
      const n = new Set(s);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });
  }

  protected annuler(): void {
    this.cochees.set(this.lues());
  }

  protected enregistrer(): void {
    const jeux = this.jeux();
    if (jeux === null || this.ecriture() || !this.modifie()) return;
    const ordre = jeux.map((j) => j.cle).filter((c) => this.cochees().has(c));
    this.ecriture.set(true);
    this.envoi?.unsubscribe();
    this.envoi = this.api.enregistrerJeuxRecommandes(this.espaceId(), ordre).subscribe({
      next: () => {
        this.ecriture.set(false);
        this.notifications.success('Sélection enregistrée');
        this.lire();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.notifications.error(messageErreur(e));
      },
    });
  }
}
