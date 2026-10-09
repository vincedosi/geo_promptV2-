import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { LIBELLES_TYPE, NOM_SOCLE, messageErreur } from './logique/libelles';
import type { JeuDeDonnees, ReponseSocle } from './logique/types';

/** Une ligne de tableau, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneJeu {
  id: string;
  nom: string;
  type: string;
  proprietaire: string;
  lignes: string;
  /** Un jeu du socle sans propriétaire ne peut pas redevenir privé : personne ne le verrait plus. */
  sansProprietaire: boolean;
}

/** Référentiels sans source en base, toujours visibles (`lib/auth/perimetre-donnees.ts`, en-tête). */
const REFERENTIELS_SYSTEME = ['Arrêts de transport', 'Installations classées (ICPE)'] as const;

const TITRE_SANS_PROPRIETAIRE = 'Ce jeu n\'a pas de propriétaire : il ne peut redevenir privé.';

type Sens = 'retirer' | 'mettre';

/**
 * Fiche « Socle dentsu.explore » (`admin/espaces/socle`, spec § 4.2, plan T6). Pas de port : aucun
 * écran React équivalent.
 *
 * - Un seul `GET admin/espaces/socle` au montage ; il rend TOUS les jeux (socle et privés), que la
 *   fiche répartit en deux tableaux. Les jeux du socle sont visibles de tous sans action : seul le
 *   super_admin change la visibilité d'un jeu (`PATCH admin/sources/:id { visibilite }`).
 * - Aucune mise à jour optimiste : un changement n'apparaît dans les tableaux qu'à la relecture qui
 *   suit une écriture RÉUSSIE. Une écriture refusée ferme la confirmation, notifie le message du
 *   serveur et laisse les tableaux tels quels.
 * - Après un succès, relecture de la fiche ET de la liste d'espaces (`etat.recharger()`) : le
 *   compteur « Socle » de la colonne doit suivre.
 * - Le décompte « {k} espaces clients ne le verront plus » est `nb_espaces_clients` moins 1 quand
 *   le propriétaire est lui-même un espace client (il garde son propre jeu), jugé sur la liste
 *   d'espaces de la page (`interne === false`).
 */
@Component({
  selector: 'mg-fiche-socle',
  imports: [NgTemplateOutlet, EnteteSectionComponent, ConfirmationComponent, Cellule, EnteteCellule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-5">
      <h2 class="m-0 text-[16px] font-medium text-primary">{{ nomSocle }}</h2>
      <p class="mb-0 mt-1 text-[13px] text-secondary">Les jeux du socle sont visibles de tous les espaces, sans action.</p>
    </header>

    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (chargement() && !charge()) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else {
      <section data-section="socle" class="section">
        <mg-entete-section class="rounded-t-lg" [libelle]="'Dans le socle (' + nbSocle() + ')'" />
        <ng-container *ngTemplateOutlet="tableau; context: { lignes: dansLeSocle(), sens: 'retirer' }" />
      </section>

      <section data-section="prives" class="section">
        <mg-entete-section class="rounded-t-lg" [libelle]="'Jeux privés (' + nbPrives() + ')'" />
        <ng-container *ngTemplateOutlet="tableau; context: { lignes: prives(), sens: 'mettre' }" />
      </section>

      <section data-section="systeme" class="section">
        <mg-entete-section class="rounded-t-lg" libelle="Référentiels système" />
        <ul class="systeme">
          @for (r of referentiels; track r) {
            <li>
              <span class="text-primary">{{ r }}</span>
              <span class="text-tertiary">Référentiel système, toujours visible</span>
            </li>
          }
        </ul>
      </section>
    }

    <ng-template #tableau let-lignes="lignes" let-sens="sens">
      @if (lignes.length === 0) {
        <p class="vide">Aucun jeu.</p>
      } @else {
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="border-b-fin border-default">
              <th mgTh alignement="gauche">Jeu</th>
              <th mgTh alignement="gauche">Type</th>
              <th mgTh alignement="gauche">Propriétaire</th>
              <th mgTh>Lignes</th>
              <th mgTh><span class="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            @for (l of lignes; track l.id) {
              <tr class="border-b-fin border-subtle">
                <td mgTd alignement="gauche" fort class="!font-sans !text-[12px]">{{ l.nom }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ l.type }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ l.proprietaire }}</td>
                <td mgTd>{{ l.lignes }}</td>
                <td mgTd>
                  @if (sens === 'retirer') {
                    <button
                      type="button"
                      class="bouton-neutre"
                      [attr.data-action]="l.id"
                      [disabled]="l.sansProprietaire"
                      [attr.title]="l.sansProprietaire ? titreSansProprietaire : null"
                      (click)="demander(l.id, 'retirer')"
                    >Retirer du socle</button>
                  } @else {
                    <button type="button" class="bouton-teal" [attr.data-action]="l.id" (click)="demander(l.id, 'mettre')">Mettre au socle</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </ng-template>

    <mg-confirmation
      [ouvert]="cible() !== null"
      [titre]="titreConfirmation()"
      [message]="messageConfirmation()"
      [variante]="cible()?.sens === 'retirer' ? 'danger' : 'defaut'"
      [libelleConfirmer]="cible()?.sens === 'retirer' ? 'Retirer du socle' : 'Mettre au socle'"
      [enCours]="ecriture()"
      (confirmer)="confirmer()"
      (annuler)="fermer()"
    />
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .section { margin-bottom: 20px; border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); }
    .vide { margin: 0; padding: 12px 14px; font-size: 12px; color: var(--text-tertiary); }
    .systeme { list-style: none; margin: 0; padding: 0; }
    .systeme li {
      display: flex; justify-content: space-between; gap: 12px; padding: 8px 14px;
      font-size: 12px; border-top: 0.5px solid var(--border-subtle);
    }
    .bouton-neutre, .bouton-teal {
      border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .bouton-neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-neutre:disabled { opacity: 0.5; cursor: not-allowed; }
    .bouton-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .bouton-teal:hover { background: var(--brand-teal-10); }
    .bouton-neutre:focus-visible, .bouton-teal:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 36px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
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
export class FicheSocleComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);

  protected readonly nomSocle = NOM_SOCLE;
  protected readonly referentiels = REFERENTIELS_SYSTEME;
  protected readonly titreSansProprietaire = TITRE_SANS_PROPRIETAIRE;

  private readonly reponse = signal<ReponseSocle | null>(null);
  protected readonly chargement = signal(false);
  protected readonly erreur = signal<string | null>(null);
  /** Le jeu en attente de confirmation, et le sens du changement. */
  protected readonly cible = signal<{ jeu: JeuDeDonnees; sens: Sens } | null>(null);
  protected readonly ecriture = signal(false);

  private requete: Subscription | null = null;
  private envoi: Subscription | null = null;

  protected readonly charge = computed(() => this.reponse() !== null);
  private readonly jeux = computed(() => this.reponse()?.jeux ?? []);

  protected readonly dansLeSocle = computed(() => this.jeux().filter((j) => j.visibilite === 'socle').map(versLigne));
  protected readonly prives = computed(() => this.jeux().filter((j) => j.visibilite !== 'socle').map(versLigne));
  protected readonly nbSocle = computed(() => this.dansLeSocle().length);
  protected readonly nbPrives = computed(() => this.prives().length);

  /** Espaces clients qui ne verraient plus le jeu retiré : tous, sauf son propriétaire s'il en est un. */
  private readonly nbEspacesPerdants = computed(() => {
    const c = this.cible();
    const total = this.reponse()?.nb_espaces_clients ?? 0;
    const idProprietaire = c?.jeu.proprietaire?.id;
    const proprietaireClient = !!idProprietaire && this.etat.espaces().some((e) => e.id === idProprietaire && e.interne === false);
    return Math.max(0, total - (proprietaireClient ? 1 : 0));
  });

  protected readonly titreConfirmation = computed(() => {
    const c = this.cible();
    if (!c) return '';
    return c.sens === 'retirer' ? `Retirer « ${c.jeu.nom} » du socle ?` : `Mettre « ${c.jeu.nom} » au socle ?`;
  });

  protected readonly messageConfirmation = computed(() => {
    const c = this.cible();
    if (!c) return '';
    if (c.sens === 'mettre') return 'Il sera visible de tous les espaces clients.';
    const k = this.nbEspacesPerdants();
    const qui = k === 0 ? 'Aucun espace client ne le verra plus.' : k === 1 ? '1 espace client ne le verra plus.' : `${formaterNombre(k)} espaces clients ne le verront plus.`;
    return `Il redeviendra privé à ${c.jeu.proprietaire?.nom_affiche ?? ''}. ${qui}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.requete?.unsubscribe();
      this.envoi?.unsubscribe();
    });
    this.lire();
  }

  /** `GET admin/espaces/socle`. Un échec garde les tableaux déjà affichés et se signale par une notification. */
  protected lire(): void {
    this.requete?.unsubscribe();
    this.chargement.set(true);
    this.erreur.set(null);
    this.requete = this.api.lireSocle().subscribe({
      next: (r) => {
        this.reponse.set(r);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        if (this.reponse() === null) this.erreur.set(messageErreur(e));
        else this.notifications.error(messageErreur(e));
      },
    });
  }

  protected demander(id: string, sens: Sens): void {
    const jeu = this.jeux().find((j) => j.id === id);
    if (!jeu || this.ecriture()) return;
    if (sens === 'retirer' && !jeu.proprietaire) return;
    this.cible.set({ jeu, sens });
  }

  protected fermer(): void {
    if (!this.ecriture()) this.cible.set(null);
  }

  protected confirmer(): void {
    const c = this.cible();
    if (!c || this.ecriture()) return;
    this.ecriture.set(true);
    const retirer = c.sens === 'retirer';
    this.envoi = this.api.modifierJeu(c.jeu.id, { visibilite: retirer ? 'privee' : 'socle' }).subscribe({
      next: () => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.success(retirer ? 'Jeu retiré du socle' : 'Jeu mis au socle');
        this.lire();
        this.etat.recharger();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.error(messageErreur(e));
      },
    });
  }
}

function versLigne(j: JeuDeDonnees): LigneJeu {
  return {
    id: j.id,
    nom: j.nom,
    type: LIBELLES_TYPE[j.type],
    proprietaire: j.proprietaire?.nom_affiche ?? '—',
    lignes: formaterNombre(j.nb_lignes),
    sansProprietaire: j.proprietaire === null,
  };
}
