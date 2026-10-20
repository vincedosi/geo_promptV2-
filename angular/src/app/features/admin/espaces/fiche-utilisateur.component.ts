import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild,
} from '@angular/core';
import type { Subscription } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { ROLE_LABELS } from '../logique/roles';
import { EspacesApi } from './data/espaces.api';
import { DialogueLienComponent } from './dialogue-lien.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { type RolePropose, estPropose, rolesAffiches, textesConfirmationRole } from './logique/fiche-utilisateur';
import { messageErreur } from './logique/libelles';
import type { MembreEspace, RoleEspace } from './logique/types';

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
 * - Les ÉCHECS (nom, rôle, lien, suppression) s'affichent dans la fiche, sous leur bloc, en
 *   `role="alert"` (vague finale du lot 6, I-1) ; les succès restent des notifications, que la pile
 *   en popover fait voir au-dessus du voile. React n'avait que des toasts, cachés sous sa modale.
 */
@Component({
  selector: 'mg-fiche-utilisateur',
  imports: [ConfirmationComponent, DialogueLienComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fiche-utilisateur.component.html',
  styleUrls: ['./fiche-commune.css', './fiche-utilisateur.component.css'],
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
  /**
   * Erreurs des autres écritures, affichées DANS le dialogue, chacune sous son bloc (vague finale,
   * I-1) : sous un `<dialog>` modal, une notification est inerte et hors de l'arbre
   * d'accessibilité. C'était le SEUL retour de ces échecs.
   */
  protected readonly erreurNom = signal<string | null>(null);
  protected readonly erreurRole = signal<string | null>(null);
  protected readonly erreurLien = signal<string | null>(null);
  protected readonly erreurSuppression = signal<string | null>(null);
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
  protected readonly confirmationRoleTextes = computed(
    () => textesConfirmationRole(this.membre().email, this.roleVise(), this.role()),
  );
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
    this.erreurNom.set(null);
    this.suivre(this.api.modifierCompte(this.membre().id, { full_name: this.nom().trim() || null }).subscribe({
      next: () => {
        this.ecritureNom.set(false);
        this.ecrit.set(true);
        this.notifications.success('Nom enregistré');
      },
      error: (e: unknown) => {
        this.ecritureNom.set(false);
        this.erreurNom.set(messageErreur(e));
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
    this.erreurRole.set(null);
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
        this.erreurRole.set(messageErreur(e));
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
    this.erreurSuppression.set(null);
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
        this.erreurSuppression.set(messageErreur(e));
      },
    }));
  }

  protected demanderLien(): void {
    if (this.lienEnCours() || this.enCours()) return;
    this.lienEnCours.set(true);
    this.erreurLien.set(null);
    this.suivre(this.api.lienMotDePasseCompte(this.membre().id).subscribe({
      next: (r) => {
        this.lienEnCours.set(false);
        if (r.lien) this.lien.set(r.lien);
        else this.erreurLien.set('Lien non généré');
      },
      error: (e: unknown) => {
        this.lienEnCours.set(false);
        this.erreurLien.set(messageErreur(e));
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
