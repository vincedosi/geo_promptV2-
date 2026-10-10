import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild,
} from '@angular/core';
import type { Subscription } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROLES, ROLE_LABELS, type UserRole } from '../logique/roles';
import { EspacesApi } from './data/espaces.api';
import { DialogueLienComponent } from './dialogue-lien.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { messageErreur } from './logique/libelles';
import type { MembreEspace, RoleEspace } from './logique/types';

/** E5 : seuls ces deux rôles sont proposés, jamais `admin`. */
const ROLES_PROPOSES = ['client', 'super_admin'] as const satisfies readonly UserRole[];
type RolePropose = (typeof ROLES_PROPOSES)[number];

/**
 * Les radios affichés : les rôles proposés, plus le rôle ACTUEL s'il ne l'est pas (un membre
 * `admin` voit son rôle coché, sans qu'on puisse le lui rendre une fois quitté). Ordre de pouvoir
 * croissant, tiré de `ROLES` (copie de `lib/auth/roles.ts`) : Client, Admin, Super admin.
 */
function rolesAffiches(actuel: RoleEspace): UserRole[] {
  return [...ROLES].reverse().filter((r) => r === actuel || (ROLES_PROPOSES as readonly UserRole[]).includes(r));
}

let compteur = 0;

/**
 * Fiche d'un utilisateur, ouverte depuis l'onglet Membres (plan T7) ou depuis la vue « Tous les
 * comptes » de la page Accès (2026-10-10) : `<dialog>` natif large (560 px), monté par un `@if` du
 * parent.
 *
 * - L'état initial vient du membre (`lireMembres`, ou un compte de `lireComptes`) : `linkedSignal`
 *   sur l'input, la fiche suit donc un changement de membre. Les espaces cochés = l'espace courant
 *   (s'il y en a un) + `autres_espaces`.
 * - Aucune mise à jour optimiste : le rôle affiché est celui que le SERVEUR a accepté. Un bouton
 *   radio coché par l'utilisateur est aussitôt remis d'aplomb dans le DOM, puis ne bascule qu'après
 *   un PATCH réussi. Passer à super_admin demande confirmation.
 * - « Enregistrer les espaces » → `PUT admin/users/:id/espaces` ; un 400 (invariant refusé par la
 *   base) affiche le message du serveur DANS la fiche.
 * - « Supprimer le compte » : désactivé sur son propre compte (le serveur refuse « Cannot delete
 *   yourself ») ; le rôle de son propre compte n'est pas modifiable non plus (on s'ôterait l'accès
 *   à cette page).
 * - « Lien de mot de passe » (2026-10-10) : `POST admin/users/:id/lien-mot-de-passe`, pour TOUT
 *   compte, avec ou sans espace. Le lien s'affiche dans `mg-dialogue-lien` (le même que l'onglet
 *   Membres) : secret d'usage unique, gardé dans un signal le temps du dialogue puis remis à `null`,
 *   jamais passé à `console.*` ni à une notification. Ce n'est pas une écriture : `fermer` n'en
 *   tient pas compte. Fermer la fiche pendant la génération abandonne la requête.
 * - Fermer émet `fermer(ecrit)` : le parent relit membres et liste si une écriture a réussi.
 */
@Component({
  selector: 'mg-fiche-utilisateur',
  imports: [ConfirmationComponent, DialogueLienComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogue
      [attr.aria-labelledby]="idTitre"
      (cancel)="surAnnulationNative($event)"
      (close)="surFermeture()"
      (click)="surClic($event)"
      (keydown.escape)="$event.stopPropagation()"
    >
      <div class="boite">
        <header>
          <p class="surtitre">Fiche utilisateur</p>
          <h2 [id]="idTitre" class="titre">{{ membre().email }}</h2>
        </header>

        <section class="bloc">
          <label class="libelle" [for]="idNom">Nom</label>
          <div class="rangee">
            <input
              [id]="idNom" data-nom type="text" maxlength="200" autocomplete="off"
              [value]="nom()" [disabled]="enCours()" (input)="saisirNom($event)"
            />
            <button type="button" data-enregistrer-nom class="bouton neutre" [disabled]="enCours()" (click)="enregistrerNom()">Enregistrer</button>
          </div>
        </section>

        <fieldset class="bloc" [disabled]="enCours() || estMoi()">
          <legend class="libelle">Rôle</legend>
          <div class="radios" [attr.title]="estMoi() ? titreSoiMeme : null">
            @for (r of roles(); track r.valeur) {
              <label class="choix">
                <input type="radio" [name]="nomGroupe" [value]="r.valeur" [checked]="r.coche" [disabled]="enCours() || estMoi()" (change)="choisirRole($event)" />
                <span>{{ r.libelle }}</span>
              </label>
            }
          </div>
        </fieldset>

        <fieldset class="bloc" [disabled]="enCours()">
          <legend class="libelle">Espaces</legend>
          <div class="cases">
            @for (e of lignesEspaces(); track e.id) {
              <label class="choix">
                <input type="checkbox" [attr.data-espace]="e.id" [checked]="e.coche" (change)="basculer(e.id, $event)" />
                <span>{{ e.nom }}</span>
              </label>
            }
          </div>
          <label class="libelle" [for]="idActif">Espace actif</label>
          <select [id]="idActif" data-actif (change)="choisirActif($event)">
            @for (o of optionsActif(); track o.id) {
              <option [value]="o.id" [selected]="o.choisi">{{ o.nom }}</option>
            }
            <option value="" [selected]="aucunActif()">Aucun (socle seul)</option>
          </select>
          @if (erreurEspaces(); as m) {
            <p role="alert" data-erreur-espaces class="erreur">{{ m }}</p>
          }
          <div class="rangee fin">
            <button type="button" data-enregistrer-espaces class="bouton teal" (click)="enregistrerEspaces()">{{ libelleEspaces() }}</button>
          </div>
        </fieldset>

        <section class="bloc">
          <p class="libelle">Mot de passe</p>
          <div class="rangee entre">
            <p class="aide">Lien d'usage unique, à transmettre à la personne.</p>
            <button
              #boutonLien type="button" data-lien-mot-de-passe class="bouton neutre"
              [disabled]="enCours() || lienEnCours()"
              (click)="demanderLien()"
            >Lien de mot de passe</button>
          </div>
        </section>

        <section class="danger">
          <div>
            <p class="danger-titre">Zone dangereuse</p>
            <p class="danger-texte">La suppression du compte est définitive.</p>
          </div>
          <button
            type="button" data-supprimer class="bouton supprimer"
            [disabled]="enCours() || lienEnCours() || estMoi()"
            [attr.title]="estMoi() ? titreSoiMeme : null"
            (click)="confirmationSuppression.set(true)"
          >Supprimer le compte</button>
        </section>

        <div class="rangee fin">
          <button type="button" data-fermer class="bouton neutre" [disabled]="enCours()" (click)="demanderFermeture()">Fermer</button>
        </div>
      </div>
    </dialog>

    <mg-confirmation
      data-confirmation-role
      [ouvert]="roleVise() !== null"
      [titre]="confirmationRoleTextes().titre"
      [message]="confirmationRoleTextes().message"
      [libelleConfirmer]="confirmationRoleTextes().bouton"
      [variante]="confirmationRoleTextes().variante"
      [enCours]="ecritureRole()"
      (confirmer)="confirmerRole()"
      (annuler)="annulerRole()"
    />
    <mg-confirmation
      data-confirmation-suppression
      variante="danger"
      [ouvert]="confirmationSuppression()"
      [titre]="titreSuppression()"
      message="Ses zones et jeux de zones restent en base, sans auteur."
      libelleConfirmer="Supprimer le compte"
      [enCours]="suppression()"
      (confirmer)="supprimer()"
      (annuler)="annulerSuppression()"
    />
    @if (lien(); as l) {
      <mg-dialogue-lien [lien]="l" [email]="membre().email" (fermer)="fermerLien()" />
    }
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; max-width: 560px; width: calc(100% - 32px); max-height: calc(100% - 32px);
      background: var(--bg-surface); color: inherit; border: 0.5px solid var(--border-default); border-radius: 12px;
    }
    dialog[open] { animation: entree 240ms var(--ease-out); }
    dialog::backdrop { background: color-mix(in srgb, black 85%, transparent); backdrop-filter: blur(4px); }
    @keyframes entree { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    .boite { padding: 24px; display: flex; flex-direction: column; gap: 18px; font-family: var(--font-sans); }
    .surtitre { margin: 0 0 2px; font-size: 11px; color: var(--text-tertiary); }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); word-break: break-all; }
    .bloc { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; border: none; min-width: 0; }
    .libelle { padding: 0; font-size: 12px; color: var(--text-tertiary); }
    .rangee { display: flex; gap: 8px; align-items: center; }
    .rangee.fin { justify-content: flex-end; }
    .rangee.entre { justify-content: space-between; }
    .aide, p.libelle { margin: 0; }
    .aide { font-size: 12px; color: var(--text-tertiary); }
    input[type='text'], select {
      flex: 1; min-width: 0;
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); outline: none;
    }
    input[type='text']:focus, select:focus { border-color: var(--brand-teal-50); }
    input:disabled, select:disabled { opacity: 0.6; }
    .radios { display: flex; gap: 20px; }
    .cases {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 16px;
      max-height: 180px; overflow-y: auto;
    }
    .choix { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
    .choix input { accent-color: var(--brand-teal); margin: 0; }
    fieldset:disabled .choix { cursor: not-allowed; opacity: 0.6; }
    .erreur {
      margin: 0; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    .danger {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 14px; border-radius: 8px;
      border: 0.5px solid color-mix(in srgb, var(--danger) 30%, transparent);
    }
    .danger-titre { margin: 0; font-size: 12px; font-weight: 500; color: var(--danger); }
    .danger-texte { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .bouton {
      flex-shrink: 0; border-radius: 6px; padding: 8px 16px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    .neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .teal:not(:disabled):hover { background: var(--brand-teal-10); }
    .supprimer { background: transparent; border: 0.5px solid var(--danger); color: var(--danger); }
    .supprimer:not(:disabled):hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
  `,
})
export class FicheUtilisateurComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationsService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private envois: Subscription[] = [];
  private detruit = false;

  private readonly n = ++compteur;
  protected readonly idTitre = `mg-fiche-utilisateur-titre-${this.n}`;
  protected readonly idNom = `mg-fiche-utilisateur-nom-${this.n}`;
  protected readonly idActif = `mg-fiche-utilisateur-actif-${this.n}`;
  protected readonly nomGroupe = `mg-fiche-utilisateur-role-${this.n}`;
  protected readonly titreSoiMeme = 'Impossible sur votre propre compte.';

  readonly membre = input.required<MembreEspace>();
  /**
   * L'espace dont l'onglet Membres a ouvert la fiche : il fait partie des espaces cochés. `null`
   * (défaut) quand la fiche est ouverte hors de tout espace — vue « Tous les comptes » : `membre`
   * porte alors TOUS ses espaces dans `autres_espaces`, et un compte sans espace n'en coche aucun.
   */
  readonly espaceId = input<string | null>(null);
  /** `true` si au moins une écriture a réussi pendant que la fiche était ouverte. */
  readonly fermer = output<boolean>();

  protected readonly nom = linkedSignal(() => this.membre().nom ?? '');
  /** Rôle ACCEPTÉ par le serveur (jamais celui qu'on vient de cliquer). */
  private readonly role = linkedSignal<RoleEspace>(() => this.membre().role);
  private readonly coches = linkedSignal<ReadonlySet<string>>(() => {
    const ici = this.espaceId();
    return new Set([...(ici === null ? [] : [ici]), ...this.membre().autres_espaces.map((e) => e.id)]);
  });
  private readonly actif = linkedSignal<string | null>(() => this.membre().espace_actif);

  private readonly ecrit = signal(false);
  private readonly ecritureNom = signal(false);
  protected readonly ecritureRole = signal(false);
  private readonly ecritureEspaces = signal(false);
  protected readonly suppression = signal(false);
  /** Rôle en attente de confirmation (les deux sens se confirment), `null` sinon. */
  protected readonly roleVise = signal<RolePropose | null>(null);
  protected readonly confirmationSuppression = signal(false);
  protected readonly erreurEspaces = signal<string | null>(null);
  protected readonly lienEnCours = signal(false);
  /** Le lien affiché : secret d'usage unique, remis à `null` à la fermeture de son dialogue. */
  protected readonly lien = signal<string | null>(null);

  protected readonly enCours = computed(
    () => this.ecritureNom() || this.ecritureRole() || this.ecritureEspaces() || this.suppression(),
  );
  protected readonly estMoi = computed(() => {
    const moi = this.auth.session()?.user?.id;
    return !!moi && moi === this.membre().id;
  });

  protected readonly roles = computed(() =>
    rolesAffiches(this.role()).map((r) => ({ valeur: r, libelle: ROLE_LABELS[r], coche: this.role() === r })),
  );

  /** Ordre de la colonne d'espaces ; un espace coché absent de la liste chargée est gardé en fin. */
  private readonly cochesOrdonnes = computed(() => {
    const c = this.coches();
    const connus = this.etat.espaces().map((e) => e.id);
    return [...connus.filter((id) => c.has(id)), ...[...c].filter((id) => !connus.includes(id))];
  });

  protected readonly lignesEspaces = computed(() =>
    this.etat.espaces().map((e) => ({ id: e.id, nom: e.nom_affiche, coche: this.coches().has(e.id) })),
  );

  protected readonly optionsActif = computed(() => {
    const noms = new Map(this.etat.espaces().map((e) => [e.id, e.nom_affiche]));
    const actif = this.actif();
    return this.cochesOrdonnes().map((id) => ({ id, nom: noms.get(id) ?? id, choisi: actif === id }));
  });
  protected readonly aucunActif = computed(() => this.actif() === null);

  protected readonly libelleEspaces = computed(() => (this.ecritureEspaces() ? 'Enregistrement…' : 'Enregistrer les espaces'));
  /** Textes de la confirmation, selon la transition (rôle accepté → rôle visé). */
  protected readonly confirmationRoleTextes = computed(() => {
    const email = this.membre().email;
    const vise = this.roleVise();
    const actuel = this.role();
    if (vise === 'client' && actuel === 'super_admin') {
      return {
        titre: 'Retirer le rôle super-administrateur ?',
        message: `${email} ne verra plus tous les espaces : il ne gardera que ceux dont il est membre.`,
        bouton: 'Retirer le rôle',
        variante: 'danger' as const,
      };
    }
    if (vise === 'client') {
      return {
        titre: `Passer au rôle ${ROLE_LABELS.client} ?`,
        message: `${email} perd le rôle ${ROLE_LABELS[actuel]}. Ce rôle n'est plus attribué depuis cette page : il ne pourra pas lui être rendu ici.`,
        bouton: `Passer au rôle ${ROLE_LABELS.client}`,
        variante: 'danger' as const,
      };
    }
    return {
      titre: 'Nommer super-administrateur ?',
      message: `${email} verra les données de tous les espaces, quel que soit son espace actif.`,
      bouton: 'Nommer super-administrateur',
      variante: 'defaut' as const,
    };
  });
  protected readonly titreSuppression = computed(() => `Supprimer définitivement ${this.membre().email} ?`);

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');
  private readonly boutonLien = viewChild<ElementRef<HTMLButtonElement>>('boutonLien');
  private readonly injector = inject(Injector);

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      for (const s of this.envois) s.unsubscribe();
      this.lien.set(null);
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected saisirNom(e: Event): void {
    this.nom.set((e.target as HTMLInputElement).value);
  }

  protected enregistrerNom(): void {
    if (this.enCours()) return;
    this.ecritureNom.set(true);
    this.suivre(this.api.modifierCompte(this.membre().id, { full_name: this.nom().trim() || null }).subscribe({
      next: () => {
        this.ecritureNom.set(false);
        this.ecrit.set(true);
        this.notifications.success('Nom enregistré');
      },
      error: (e: unknown) => {
        this.ecritureNom.set(false);
        this.notifications.error(messageErreur(e));
      },
    }));
  }

  /**
   * Le navigateur a déjà coché le bouton cliqué : on remet le DOM sur le rôle accepté, puis on
   * demande confirmation, dans les deux sens. Le bouton ne basculera qu'au succès du PATCH ;
   * une annulation laisse donc le DOM sur le rôle accepté.
   */
  protected choisirRole(e: Event): void {
    const voulu = (e.target as HTMLInputElement).value;
    this.resynchroniserRadios();
    if (voulu === this.role() || this.enCours() || this.estMoi()) return;
    if (!estPropose(voulu)) return;
    this.roleVise.set(voulu);
  }

  protected annulerRole(): void {
    if (this.ecritureRole()) return;
    this.roleVise.set(null);
    this.resynchroniserRadios();
  }

  protected confirmerRole(): void {
    const role = this.roleVise();
    if (!role || this.ecritureRole()) return;
    this.ecritureRole.set(true);
    this.suivre(this.api.modifierCompte(this.membre().id, { role }).subscribe({
      next: () => {
        this.ecritureRole.set(false);
        this.roleVise.set(null);
        this.role.set(role);
        this.ecrit.set(true);
        this.notifications.success('Rôle enregistré', ROLE_LABELS[role]);
      },
      error: (e: unknown) => {
        this.ecritureRole.set(false);
        this.roleVise.set(null);
        this.resynchroniserRadios();
        this.notifications.error(messageErreur(e));
      },
    }));
  }

  /** Décocher l'espace actif reporte le choix sur le premier espace coché restant, sinon « Aucun ». */
  protected basculer(id: string, e: Event): void {
    const coche = (e.target as HTMLInputElement).checked;
    const suivant = new Set(this.coches());
    if (coche) suivant.add(id);
    else suivant.delete(id);
    this.coches.set(suivant);
    this.erreurEspaces.set(null);
    if (!coche && this.actif() === id) this.actif.set(this.cochesOrdonnes()[0] ?? null);
  }

  protected choisirActif(e: Event): void {
    this.actif.set((e.target as HTMLSelectElement).value || null);
    this.erreurEspaces.set(null);
  }

  protected enregistrerEspaces(): void {
    if (this.enCours()) return;
    this.ecritureEspaces.set(true);
    this.erreurEspaces.set(null);
    this.suivre(this.api.remplacerEspaces(this.membre().id, this.cochesOrdonnes(), this.actif()).subscribe({
      next: (r) => {
        this.ecritureEspaces.set(false);
        this.coches.set(new Set(r.espaces));
        this.actif.set(r.espace_actif);
        this.ecrit.set(true);
        this.notifications.success('Espaces enregistrés');
      },
      error: (e: unknown) => {
        this.ecritureEspaces.set(false);
        this.erreurEspaces.set(messageErreur(e));
      },
    }));
  }

  protected annulerSuppression(): void {
    if (!this.suppression()) this.confirmationSuppression.set(false);
  }

  protected supprimer(): void {
    if (this.suppression() || this.estMoi()) return;
    this.suppression.set(true);
    this.suivre(this.api.supprimerCompte(this.membre().id).subscribe({
      next: () => {
        this.suppression.set(false);
        this.confirmationSuppression.set(false);
        this.ecrit.set(true);
        this.notifications.success('Compte supprimé', this.membre().email);
        this.fermer.emit(true);
      },
      error: (e: unknown) => {
        this.suppression.set(false);
        this.confirmationSuppression.set(false);
        this.notifications.error(messageErreur(e));
      },
    }));
  }

  protected demanderLien(): void {
    if (this.lienEnCours() || this.enCours()) return;
    this.lienEnCours.set(true);
    this.suivre(this.api.lienMotDePasseCompte(this.membre().id).subscribe({
      next: (r) => {
        this.lienEnCours.set(false);
        if (r.lien) this.lien.set(r.lien);
        else this.notifications.error('Lien non généré');
      },
      error: (e: unknown) => {
        this.lienEnCours.set(false);
        this.notifications.error(messageErreur(e));
      },
    }));
  }

  /**
   * Le lien quitte l'état, puis — une fois son `<dialog>` retiré du DOM, au rendu suivant — le
   * focus revient au bouton. Tant que ce dialogue modal est ouvert, la fiche est inerte : un
   * `focus()` immédiat serait ignoré et le focus tomberait sur le `<body>` (constaté au navigateur).
   */
  protected fermerLien(): void {
    this.lien.set(null);
    const bouton = this.boutonLien();
    afterNextRender(() => bouton?.nativeElement.focus(), { injector: this.injector });
  }

  protected demanderFermeture(): void {
    if (!this.enCours()) this.fermer.emit(this.ecrit());
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    this.demanderFermeture();
  }

  /**
   * Fermeture native qu'on n'a pas pu empêcher (Chrome laisse passer un second Échap). Pendant une
   * écriture, elle a pu aboutir côté serveur : `fermer(true)` pour que le parent relise.
   */
  protected surFermeture(): void {
    if (!this.detruit) this.fermer.emit(this.ecrit() || this.enCours());
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.demanderFermeture();
  }

  private suivre(s: Subscription): void {
    this.envois = [...this.envois.filter((x) => !x.closed), s];
  }

  private resynchroniserRadios(): void {
    const role = this.role();
    for (const r of this.hote.nativeElement.querySelectorAll<HTMLInputElement>(`input[name="${this.nomGroupe}"]`)) {
      r.checked = r.value === role;
    }
  }
}

function estPropose(r: string): r is RolePropose {
  return (ROLES_PROPOSES as readonly string[]).includes(r);
}
