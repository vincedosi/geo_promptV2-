import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { ROLE_LABELS } from '../logique/roles';
import { EspacesApi } from './data/espaces.api';
import { DialogueAjoutMembreComponent } from './dialogue-ajout-membre.component';
import { DialogueLienComponent } from './dialogue-lien.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { FicheUtilisateurComponent } from './fiche-utilisateur.component';
import { messageErreur } from './logique/libelles';
import type { MembreEspace } from './logique/types';

/** Une ligne du tableau, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneMembre {
  id: string;
  nom: string;
  email: string;
  role: string;
  superAdmin: boolean;
  autres: { id: string; nom: string }[];
  actif: string;
}

const AUCUN_ACTIF = 'Aucun (socle seul)';

/**
 * Onglet « Membres » de la fiche d'un espace (spec § 4.3, plan T7).
 *
 * - `espaceId` est un input RÉACTIF : la fiche réutilise l'onglet d'un espace à l'autre, et chaque
 *   changement relit les membres (`GET admin/espaces/:id/membres`) en abandonnant la lecture en vol.
 * - Aucune mise à jour optimiste. Retirer un membre (`DELETE …/members { userId }`) : succès →
 *   notification, relecture des membres et de la liste d'espaces ; échec → notification du message
 *   du serveur, tableau inchangé.
 * - « Lien de mot de passe » : le lien est un secret d'usage unique, gardé dans un signal le temps
 *   du dialogue puis remis à `null` ; jamais passé à `console.*`.
 * - Clic ou Entrée sur une ligne → fiche utilisateur ; les boutons d'action ne l'ouvrent pas.
 */
@Component({
  selector: 'mg-onglet-membres',
  imports: [ConfirmationComponent, Cellule, EnteteCellule, DialogueAjoutMembreComponent, DialogueLienComponent, FicheUtilisateurComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="barre">
      <button type="button" data-ajouter class="bouton-teal" (click)="ajoutOuvert.set(true)">Ajouter un membre</button>
    </div>

    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (membres() === null) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else if (lignes().length === 0) {
      <p class="vide">Aucun membre dans cet espace.</p>
    } @else {
      <div class="cadre">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="border-b-fin border-default">
              <th mgTh alignement="gauche">Utilisateur</th>
              <th mgTh alignement="gauche">Rôle</th>
              <th mgTh alignement="gauche">Autres espaces</th>
              <th mgTh alignement="gauche">Espace actif</th>
              <th mgTh><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (l of lignes(); track l.id) {
              <tr
                class="ligne border-b-fin border-subtle"
                tabindex="0"
                [attr.data-membre]="l.id"
                [attr.aria-label]="'Ouvrir la fiche de ' + l.email"
                (click)="ouvrirFiche(l.id, $event)"
                (keydown.enter)="ouvrirFiche(l.id, $event)"
              >
                <td mgTd alignement="gauche" class="!font-sans">
                  <span class="nom">{{ l.nom }}</span>
                  <span class="email">{{ l.email }}</span>
                </td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">
                  <span class="role">{{ l.role }}</span>
                  @if (l.superAdmin) {
                    <span class="pastille teal">Voit tous les espaces</span>
                  }
                </td>
                <td mgTd alignement="gauche" class="!font-sans" data-autres>
                  @for (a of l.autres; track a.id) {
                    <span class="pastille">{{ a.nom }}</span>
                  } @empty {
                    <span class="attenue">—</span>
                  }
                </td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]" data-actif>{{ l.actif }}</td>
                <td mgTd>
                  <span class="actions">
                    <button type="button" class="bouton-neutre" [attr.data-lien]="l.id" [disabled]="lienEnCours()" (click)="demanderLien(l.id)">Lien de mot de passe</button>
                    <button type="button" class="bouton-neutre" [attr.data-retirer]="l.id" (click)="demanderRetrait(l.id)">Retirer de l'espace</button>
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <mg-confirmation
      variante="danger"
      [ouvert]="cible() !== null"
      [titre]="titreRetrait()"
      [message]="messageRetrait()"
      libelleConfirmer="Retirer de l'espace"
      [enCours]="ecriture()"
      (confirmer)="confirmerRetrait()"
      (annuler)="fermerRetrait()"
    />

    @if (lien(); as l) {
      <mg-dialogue-lien [lien]="l.lien" [email]="l.email" (fermer)="lien.set(null)" />
    }
    @if (ajoutOuvert()) {
      <mg-dialogue-ajout-membre
        [espaceId]="espaceId()"
        [membresIds]="idsMembres()"
        (ajoute)="apresEcriture()"
        (fermer)="ajoutOuvert.set(false)"
      />
    }
    @if (fiche(); as m) {
      <mg-fiche-utilisateur [membre]="m" [espaceId]="espaceId()" (fermer)="fermerFiche($event)" />
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .barre { display: flex; justify-content: flex-end; margin-bottom: 12px; }
    .cadre { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow-x: auto; }
    .ligne { cursor: pointer; transition: background-color 150ms var(--ease-hover); }
    .ligne:hover { background: var(--bg-level-2); }
    .ligne:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: -2px; }
    .nom { display: block; font-size: 12px; color: var(--text-primary); }
    .email { display: block; font-size: 11px; color: var(--text-tertiary); }
    .role { margin-right: 6px; }
    .pastille {
      display: inline-block; margin: 2px 4px 2px 0; padding: 2px 8px; border-radius: 4px; white-space: nowrap;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-secondary); font-size: 10px;
    }
    .pastille.teal { background: var(--brand-teal-10); border-color: var(--brand-teal-30); color: var(--teal-texte); }
    .attenue { color: var(--text-tertiary); }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .vide { margin: 0; padding: 12px 14px; font-size: 12px; color: var(--text-tertiary); }
    .bouton-neutre, .bouton-teal {
      border-radius: 6px; font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre { padding: 5px 12px; background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .bouton-neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-neutre:disabled { opacity: 0.5; cursor: not-allowed; }
    .bouton-teal { padding: 8px 16px; background: transparent; border: 0.5px solid var(--brand-teal); color: var(--teal-texte); }
    .bouton-teal:hover { background: var(--brand-teal-10); }
    .bouton-neutre:focus-visible, .bouton-teal:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 36px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger-texte);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
})
export class OngletMembresComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);

  readonly espaceId = input.required<string>();

  /** `null` tant que la première lecture n'a pas répondu. */
  protected readonly membres = signal<readonly MembreEspace[] | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly cible = signal<MembreEspace | null>(null);
  protected readonly ecriture = signal(false);
  protected readonly lienEnCours = signal(false);
  /** Le lien de réinitialisation affiché : secret d'usage unique, remis à `null` à la fermeture. */
  protected readonly lien = signal<{ email: string; lien: string } | null>(null);
  protected readonly ajoutOuvert = signal(false);
  protected readonly fiche = signal<MembreEspace | null>(null);

  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;
  private demandeLien: Subscription | null = null;

  private readonly nomsEspaces = computed(() => new Map(this.etat.espaces().map((e) => [e.id, e.nom_affiche])));
  private readonly nomEspace = computed(() => this.nomsEspaces().get(this.espaceId()) ?? '');

  protected readonly lignes = computed<LigneMembre[]>(() => {
    const noms = this.nomsEspaces();
    const ici = this.espaceId();
    return (this.membres() ?? []).map((m) => {
      const autres = m.autres_espaces.map((a) => ({ id: a.id, nom: a.nom_affiche }));
      let actif = AUCUN_ACTIF;
      if (m.espace_actif !== null) {
        actif = m.espace_actif === ici
          ? this.nomEspace()
          : autres.find((a) => a.id === m.espace_actif)?.nom ?? noms.get(m.espace_actif) ?? '—';
      }
      return {
        id: m.id,
        nom: m.nom || m.email,
        email: m.email,
        role: ROLE_LABELS[m.role] ?? m.role,
        superAdmin: m.role === 'super_admin',
        autres,
        actif,
      };
    });
  });

  protected readonly idsMembres = computed(() => (this.membres() ?? []).map((m) => m.id));

  protected readonly titreRetrait = computed(() => {
    const c = this.cible();
    return c ? `Retirer ${c.email} de ${this.nomEspace()} ?` : '';
  });

  /** Les quatre cas de la spec § 4.3. Le serveur choisit le plus ancien des autres espaces, que l'écran ne connaît pas. */
  protected readonly messageRetrait = computed(() => {
    const c = this.cible();
    if (!c) return '';
    if (c.role === 'super_admin') return 'Il reste super-administrateur et voit toujours tous les espaces.';
    if (c.espace_actif !== this.espaceId()) return 'Son espace actif ne change pas.';
    if (c.autres_espaces.length > 0) {
      return `Il basculera sur un de ses autres espaces (${c.autres_espaces.map((a) => a.nom_affiche).join(', ')}).`;
    }
    return 'Il ne verra plus que le socle.';
  });

  constructor() {
    // Lecture à chaque changement d'espace (input réactif) ; la lecture elle-même hors suivi.
    effect(() => {
      this.espaceId();
      untracked(() => this.changerDEspace());
    });
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.envoi?.unsubscribe();
      this.demandeLien?.unsubscribe();
      this.lien.set(null);
    });
  }

  /** `GET admin/espaces/:id/membres`. Une relecture qui échoue garde le tableau et le notifie. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    const id = this.espaceId();
    this.lecture = this.api.lireMembres(id).subscribe({
      next: (r) => this.membres.set(r.membres ?? []),
      error: (e: unknown) => {
        if (this.membres() === null) this.erreur.set(messageErreur(e));
        else this.notifications.error(messageErreur(e));
      },
    });
  }

  protected ouvrirFiche(id: string, e: Event): void {
    if ((e.target as Element | null)?.closest('button')) return;
    const m = this.membres()?.find((x) => x.id === id);
    if (m) this.fiche.set(m);
  }

  protected fermerFiche(ecrit: boolean): void {
    this.fiche.set(null);
    if (ecrit) this.apresEcriture();
  }

  protected demanderRetrait(id: string): void {
    const m = this.membres()?.find((x) => x.id === id);
    if (m && !this.ecriture()) this.cible.set(m);
  }

  protected fermerRetrait(): void {
    if (!this.ecriture()) this.cible.set(null);
  }

  protected confirmerRetrait(): void {
    const c = this.cible();
    if (!c || this.ecriture()) return;
    this.ecriture.set(true);
    this.envoi = this.api.retirerMembre(this.espaceId(), c.id).subscribe({
      next: () => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.success('Membre retiré de l\'espace', c.email);
        this.apresEcriture();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.error(messageErreur(e));
      },
    });
  }

  protected demanderLien(id: string): void {
    const m = this.membres()?.find((x) => x.id === id);
    if (!m || this.lienEnCours()) return;
    this.lienEnCours.set(true);
    this.demandeLien = this.api.lienMotDePasse(this.espaceId(), m.email).subscribe({
      next: (r) => {
        this.lienEnCours.set(false);
        if (r.link) this.lien.set({ email: m.email, lien: r.link });
        else this.notifications.error('Lien non généré');
      },
      error: (e: unknown) => {
        this.lienEnCours.set(false);
        this.notifications.error(messageErreur(e));
      },
    });
  }

  /** Après une écriture réussie : relecture des membres ET des compteurs de la colonne. */
  protected apresEcriture(): void {
    this.lire();
    this.etat.recharger();
  }

  /** Nouvel espace : tout ce qui concernait l'ancien est abandonné, puis relecture. */
  private changerDEspace(): void {
    this.envoi?.unsubscribe();
    this.demandeLien?.unsubscribe();
    this.ecriture.set(false);
    this.lienEnCours.set(false);
    this.cible.set(null);
    this.lien.set(null);
    this.ajoutOuvert.set(false);
    this.fiche.set(null);
    this.membres.set(null);
    this.lire();
  }
}
