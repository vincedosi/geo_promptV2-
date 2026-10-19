import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { type CompteAdmin, EspacesApi } from './data/espaces.api';
import { ROLE_LABELS } from '../logique/roles';
import { CompteCreeComponent } from './compte-cree.component';
import { emailValide, messageErreur } from './logique/libelles';

type Mode = 'existant' | 'nouveau';

/** Au plus autant de propositions affichées : la recherche affine, la liste ne défile pas sans fin. */
const MAX_PROPOSITIONS = 30;

const MESSAGE_409 = 'Ce compte existe déjà : ajoutez-le depuis « Compte existant ».';

let compteur = 0;

/**
 * « Ajouter un membre » à l'espace `espaceId` (plan T7) : `<dialog>` natif, monté par un `@if` du
 * parent et démonté à la fermeture (chaque ouverture repart de zéro).
 *
 * - « Compte existant » : `GET admin/users` UNE fois, à l'ouverture, puis filtre LOCAL par email
 *   (aucune requête par frappe). Les comptes déjà membres (`membresIds`) ne sont pas proposés.
 *   Choisir un compte → `POST …/members { email }`, SANS rôle (E3) ; succès → `ajoute` puis `fermer`.
 * - « Nouveau compte » : rôle FIXÉ à `client` (E5 ; nommer un super_admin se fait depuis la fiche
 *   utilisateur). 201 → écran « Compte créé » avec le lien d'initialisation, secret d'usage unique :
 *   affiché une fois, jamais journalisé, effacé avec le composant (écran partagé `mg-compte-cree`).
 *   409 → message dans le dialogue.
 * - Toute écriture refusée reste visible dans le dialogue (`role="alert"`), rien n'est émis.
 */
@Component({
  selector: 'mg-dialogue-ajout-membre',
  imports: [CompteCreeComponent],
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
        @if (compteCree(); as cree) {
          <mg-compte-cree [idTitre]="idTitre" [texte]="texteCree()" [lien]="cree.lien" (terminer)="terminer()" />
        } @else {
          <h2 [id]="idTitre" class="titre">Ajouter un membre</h2>
          <div role="tablist" aria-label="Type de compte" class="onglets">
            <button
              type="button" role="tab" data-mode="existant" class="onglet"
              [attr.aria-selected]="mode() === 'existant'" [disabled]="enCours()" (click)="choisirMode('existant')"
            >Compte existant</button>
            <button
              type="button" role="tab" data-mode="nouveau" class="onglet"
              [attr.aria-selected]="mode() === 'nouveau'" [disabled]="enCours()" (click)="choisirMode('nouveau')"
            >Nouveau compte</button>
          </div>

          @if (mode() === 'existant') {
            <label class="champ">
              <span class="libelle">Rechercher par email</span>
              <input
                data-recherche type="search" autocomplete="off" placeholder="nom@exemple.fr"
                [value]="recherche()" [disabled]="enCours()" (input)="saisirRecherche($event)"
              />
            </label>
            @if (erreurComptes(); as m) {
              <p role="alert" class="erreur">{{ m }}</p>
            } @else if (comptes() === null) {
              <p class="texte attenue">Chargement des comptes…</p>
            } @else if (propositions().length === 0) {
              <p class="texte attenue">Aucun compte à proposer.</p>
            } @else {
              <ul class="propositions">
                @for (c of propositions(); track c.id) {
                  <li>
                    <button type="button" class="proposition" [attr.data-compte]="c.id" [disabled]="enCours()" (click)="ajouter(c)">
                      <span class="email">{{ c.email }}</span>
                      @if (c.full_name) { <span class="nom">{{ c.full_name }}</span> }
                    </button>
                  </li>
                }
              </ul>
            }
            @if (erreur(); as m) {
              <p role="alert" class="erreur">{{ m }}</p>
            }
            <div class="actions">
              <button type="button" data-annuler class="bouton neutre" [disabled]="enCours()" (click)="fermer.emit()">Annuler</button>
            </div>
          } @else {
            <form data-nouveau class="formulaire" novalidate (submit)="$event.preventDefault(); creer()">
              <label class="champ">
                <span class="libelle">Email</span>
                <input
                  data-email type="email" required autocomplete="off" placeholder="nom@exemple.fr"
                  [value]="email()" [disabled]="enCours()" (input)="saisirEmail($event)"
                />
              </label>
              <label class="champ">
                <span class="libelle">Nom <span class="attenue">(facultatif)</span></span>
                <input data-nom type="text" autocomplete="off" maxlength="200" [value]="nom()" [disabled]="enCours()" (input)="saisirNom($event)" />
              </label>
              <p class="texte attenue">Le compte est créé avec le rôle {{ libelleClient }}. Un super-administrateur se nomme depuis sa fiche.</p>
              @if (erreur(); as m) {
                <p role="alert" class="erreur">{{ m }}</p>
              }
              <div class="actions">
                <button type="button" data-annuler class="bouton neutre" [disabled]="enCours()" (click)="fermer.emit()">Annuler</button>
                <button type="submit" data-creer class="bouton principal" [disabled]="!peutCreer()">{{ libelleCreer() }}</button>
              </div>
            </form>
          }
        }
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; max-width: 480px; width: calc(100% - 32px);
      background: var(--bg-surface); color: inherit; border: 0.5px solid var(--border-default); border-radius: 12px;
    }
    dialog[open] { animation: entree 240ms var(--ease-out); }
    dialog::backdrop { background: color-mix(in srgb, black 85%, transparent); backdrop-filter: blur(4px); }
    @keyframes entree { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    .boite { padding: 24px; display: flex; flex-direction: column; gap: 14px; font-family: var(--font-sans); }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); }
    .texte { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .attenue { color: var(--text-tertiary); font-size: 12px; }
    .onglets { display: flex; gap: 16px; border-bottom: 0.5px solid var(--border-subtle); }
    .onglet {
      background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -0.5px;
      padding: 6px 0; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--text-tertiary); cursor: pointer;
    }
    .onglet:hover { color: var(--text-secondary); }
    .onglet[aria-selected='true'] { color: var(--text-primary); border-bottom-color: var(--brand-teal); }
    .onglet:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .formulaire { display: flex; flex-direction: column; gap: 14px; }
    .champ { display: flex; flex-direction: column; gap: 6px; }
    .libelle { font-size: 12px; color: var(--text-tertiary); }
    input {
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); outline: none;
    }
    input::placeholder { color: var(--text-tertiary); }
    input:focus { border-color: var(--brand-teal-50); }
    input:disabled { opacity: 0.6; }
    .propositions {
      list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto;
      border: 0.5px solid var(--border-subtle); border-radius: 6px;
    }
    .propositions li + li { border-top: 0.5px solid var(--border-subtle); }
    .proposition {
      display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
      background: transparent; border: none; padding: 8px 12px; cursor: pointer; font-family: var(--font-sans);
    }
    .proposition:hover:not(:disabled) { background: var(--bg-level-2); }
    .proposition:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: -2px; }
    .proposition:disabled { opacity: 0.5; cursor: not-allowed; }
    .email { font-size: 13px; color: var(--text-primary); }
    .nom { font-size: 11px; color: var(--text-tertiary); }
    .erreur {
      margin: 0; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: var(--danger-texte);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .bouton {
      border-radius: 6px; padding: 9px 18px; font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover);
    }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .principal { border: none; background: var(--text-primary); color: var(--bg-primary); }
    .principal:not(:disabled):hover { opacity: 0.85; }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
  `,
})
export class DialogueAjoutMembreComponent {
  private readonly api = inject(EspacesApi);
  private readonly notifications = inject(NotificationsService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;
  private detruit = false;

  protected readonly idTitre = `mg-ajout-membre-titre-${++compteur}`;
  protected readonly libelleClient = ROLE_LABELS.client;

  readonly espaceId = input.required<string>();
  /** Identifiants des comptes déjà membres de l'espace : jamais proposés. */
  readonly membresIds = input<readonly string[]>([]);
  /** Une appartenance a été créée : le parent relit les membres et la liste d'espaces. */
  readonly ajoute = output<void>();
  readonly fermer = output<void>();

  protected readonly mode = signal<Mode>('existant');
  /** Comptes lus une fois à l'ouverture ; `null` tant que la lecture n'a pas répondu. */
  protected readonly comptes = signal<readonly CompteAdmin[] | null>(null);
  protected readonly erreurComptes = signal<string | null>(null);
  protected readonly recherche = signal('');
  protected readonly email = signal('');
  protected readonly nom = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  /** Écran « Compte créé » : le lien d'initialisation est un secret, effacé avec le composant. */
  protected readonly compteCree = signal<{ email: string; lien: string | null } | null>(null);

  protected readonly propositions = computed(() => {
    const liste = this.comptes() ?? [];
    const exclus = new Set(this.membresIds());
    const filtre = this.recherche().trim().toLowerCase();
    return liste
      .filter((c) => !exclus.has(c.id) && (filtre === '' || c.email.toLowerCase().includes(filtre)))
      .slice(0, MAX_PROPOSITIONS);
  });

  protected readonly texteCree = computed(() => `${this.compteCree()?.email ?? ''} est membre de l'espace.`);
  protected readonly peutCreer = computed(() => emailValide(this.email()) && !this.enCours());
  protected readonly libelleCreer = computed(() => (this.enCours() ? 'Création…' : 'Créer le compte'));

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.compteCree.set(null);
      this.lecture?.unsubscribe();
      this.envoi?.unsubscribe();
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
    this.lecture = this.api.listerComptes().subscribe({
      next: (c) => this.comptes.set(c ?? []),
      error: (e: unknown) => this.erreurComptes.set(messageErreur(e)),
    });
  }

  protected choisirMode(m: Mode): void {
    this.mode.set(m);
    this.erreur.set(null);
  }

  protected saisirRecherche(e: Event): void {
    this.recherche.set((e.target as HTMLInputElement).value);
  }

  protected saisirEmail(e: Event): void {
    this.email.set((e.target as HTMLInputElement).value);
    this.erreur.set(null);
  }

  protected saisirNom(e: Event): void {
    this.nom.set((e.target as HTMLInputElement).value);
  }

  protected ajouter(c: CompteAdmin): void {
    if (this.enCours()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    this.envoi = this.api.ajouterMembre(this.espaceId(), c.email).subscribe({
      next: () => {
        this.enCours.set(false);
        this.notifications.success('Membre ajouté', c.email);
        this.ajoute.emit();
        this.fermer.emit();
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        this.erreur.set(messageErreur(e));
      },
    });
  }

  protected creer(): void {
    if (!this.peutCreer()) return;
    const email = this.email().trim();
    const nom = this.nom().trim() || null;
    this.enCours.set(true);
    this.erreur.set(null);
    this.envoi = this.api.creerCompte({ email, full_name: nom, role: 'client', organization_id: this.espaceId() }).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.compteCree.set({ email: r.email ?? email, lien: r.setup_link ?? null });
        this.ajoute.emit();
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        this.erreur.set(e instanceof HttpErrorResponse && e.status === 409 ? MESSAGE_409 : messageErreur(e));
      },
    });
  }

  /** Seule sortie de l'écran « Compte créé » : le lien est effacé de l'état, puis le parent démonte. */
  protected terminer(): void {
    this.compteCree.set(null);
    this.fermer.emit();
  }

  /** Échap : ignoré pendant un envoi et sur « Compte créé » (un lien d'usage unique ne se perd pas par mégarde). */
  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    if (!this.enCours() && this.compteCree() === null) this.fermer.emit();
  }

  /**
   * Fermeture native qu'on n'a pas pu empêcher (Chrome laisse passer un second Échap).
   * - Sur « Compte créé » : le dialogue est rouvert, le lien reste lisible jusqu'à « Terminer ».
   * - Pendant un envoi : l'écriture a pu aboutir côté serveur — `ajoute` est émis pour que le
   *   parent relise, puis `fermer`.
   */
  protected surFermeture(): void {
    if (this.detruit) return;
    if (this.compteCree() !== null) {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
      return;
    }
    if (this.enCours()) this.ajoute.emit();
    this.fermer.emit();
  }

  /** Clic sur le fond : même règle qu'Échap. */
  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement && !this.enCours() && this.compteCree() === null) this.fermer.emit();
  }
}
