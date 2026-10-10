import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild,
} from '@angular/core';
import type { Subscription } from 'rxjs';
import { ROLE_LABELS } from '../logique/roles';
import { CompteCreeComponent } from './compte-cree.component';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { emailValide, messageErreur } from './logique/libelles';

/** E5 : seuls ces deux rôles sont proposés, jamais `admin`. */
const ROLES_PROPOSES = ['client', 'super_admin'] as const;
type RolePropose = (typeof ROLES_PROPOSES)[number];

/** La règle de `POST /api/admin/users` : un espace est obligatoire pour tout rôle autre que super_admin. */
const AIDE_ESPACE = 'Un espace est obligatoire pour un compte client.';
const MESSAGE_SANS_LIEN = 'Le compte est créé, mais le lien n\'a pas pu être généré. Générez-en un avec « Lien de mot de passe » depuis sa fiche (liste « Tous les comptes »).';

let compteur = 0;

/**
 * « Créer un compte » depuis la vue « Tous les comptes » de la page Accès (2026-10-10) — reprend le
 * formulaire de la page React Users (email · nom · rôle · espace) : `<dialog>` natif, monté par un
 * `@if` du parent et démonté à la fermeture (chaque ouverture repart de zéro).
 *
 * - Rôle Client (défaut) ou Super admin, jamais Admin (E5). La route ne refuse `super_admin` qu'à
 *   un appelant non super_admin, et elle n'est ouverte qu'aux super_admin (`requireAdmin`) : les
 *   deux rôles proposés sont donc acceptés.
 * - Espace : les espaces ACTIFS seulement (la route répond 400 sur un espace désactivé) ;
 *   obligatoire pour un client, facultatif pour un super_admin — la règle du serveur, appliquée
 *   AVANT l'envoi (bouton désactivé, aide affichée).
 * - 201 → écran « Compte créé » partagé (`mg-compte-cree`) : le lien d'initialisation est un secret
 *   d'usage unique, affiché une fois, jamais journalisé, effacé à « Terminer » et à la destruction ;
 *   Échap et un clic sur le fond y sont ignorés. `cree` est émis : le parent relit la liste.
 * - Toute écriture refusée (409 compris) reste visible dans le dialogue (`role="alert"`).
 */
@Component({
  selector: 'mg-dialogue-creation-compte',
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
          <mg-compte-cree [idTitre]="idTitre" [texte]="texteCree()" [lien]="cree.lien" [messageSansLien]="messageSansLien" (terminer)="terminer()" />
        } @else {
          <h2 [id]="idTitre" class="titre">Créer un compte</h2>
          <form class="formulaire" novalidate (submit)="$event.preventDefault(); creer()">
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
            <fieldset class="champ" [disabled]="enCours()">
              <legend class="libelle">Rôle</legend>
              <div class="radios">
                @for (r of roles(); track r.valeur) {
                  <label class="choix">
                    <input type="radio" [name]="nomGroupe" [value]="r.valeur" [checked]="r.coche" (change)="choisirRole($event)" />
                    <span>{{ r.libelle }}</span>
                  </label>
                }
              </div>
              @if (superAdmin()) {
                <p class="attenue">Un super admin voit les données de tous les espaces, quel que soit son espace actif.</p>
              }
            </fieldset>
            <label class="champ">
              <span class="libelle">Espace @if (superAdmin()) { <span class="attenue">(facultatif)</span> }</span>
              <select data-espace [disabled]="enCours()" (change)="choisirEspace($event)">
                <option value="" [selected]="espace() === ''">Aucun</option>
                @for (e of options(); track e.id) {
                  <option [value]="e.id" [selected]="e.choisi">{{ e.nom }}</option>
                }
              </select>
            </label>
            @if (aideEspace(); as aide) {
              <p data-aide-espace class="aide">{{ aide }}</p>
            }
            @if (erreur(); as m) {
              <p role="alert" class="erreur">{{ m }}</p>
            }
            <div class="actions">
              <button type="button" data-annuler class="bouton neutre" [disabled]="enCours()" (click)="fermer.emit()">Annuler</button>
              <button type="submit" data-creer class="bouton principal" [disabled]="!peutCreer()">{{ libelleCreer() }}</button>
            </div>
          </form>
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
    .formulaire { display: flex; flex-direction: column; gap: 14px; }
    .champ { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: none; min-width: 0; }
    .libelle { padding: 0; font-size: 12px; color: var(--text-tertiary); }
    .attenue { margin: 0; color: var(--text-tertiary); font-size: 12px; }
    input[type='email'], input[type='text'], select {
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); outline: none;
    }
    input::placeholder { color: var(--text-tertiary); }
    input:focus, select:focus { border-color: var(--brand-teal-50); }
    input:disabled, select:disabled { opacity: 0.6; }
    .radios { display: flex; gap: 20px; }
    .choix { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
    .choix input { accent-color: var(--brand-teal); margin: 0; }
    fieldset:disabled .choix { cursor: not-allowed; opacity: 0.6; }
    .aide { margin: 0; font-size: 12px; color: var(--warning); }
    .erreur {
      margin: 0; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
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
    .principal:not(:disabled):hover { background: var(--cta-hover); }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
  `,
})
export class DialogueCreationCompteComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private envoi: Subscription | null = null;
  private detruit = false;

  private readonly n = ++compteur;
  protected readonly idTitre = `mg-creation-compte-titre-${this.n}`;
  protected readonly nomGroupe = `mg-creation-compte-role-${this.n}`;
  protected readonly messageSansLien = MESSAGE_SANS_LIEN;

  /** Un compte a été créé : le parent relit la liste des comptes et les compteurs. */
  readonly cree = output<void>();
  readonly fermer = output<void>();

  protected readonly email = signal('');
  protected readonly nom = signal('');
  protected readonly role = signal<RolePropose>('client');
  /** Identifiant de l'espace choisi, `''` pour « Aucun ». */
  protected readonly espace = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  /** Écran « Compte créé » : le lien d'initialisation est un secret, effacé avec le composant. */
  protected readonly compteCree = signal<{ email: string; lien: string | null; texte: string } | null>(null);

  protected readonly superAdmin = computed(() => this.role() === 'super_admin');
  protected readonly roles = computed(() =>
    ROLES_PROPOSES.map((r) => ({ valeur: r, libelle: ROLE_LABELS[r], coche: this.role() === r })),
  );
  /** Espaces actifs, dans l'ordre de la colonne : la route refuse un espace désactivé. */
  protected readonly options = computed(() =>
    this.etat.espaces().filter((e) => e.actif).map((e) => ({ id: e.id, nom: e.nom_affiche, choisi: this.espace() === e.id })),
  );
  protected readonly aideEspace = computed(() => (!this.superAdmin() && this.espace() === '' ? AIDE_ESPACE : null));
  protected readonly peutCreer = computed(
    () => emailValide(this.email()) && this.aideEspace() === null && !this.enCours(),
  );
  protected readonly libelleCreer = computed(() => (this.enCours() ? 'Création…' : 'Créer le compte'));
  protected readonly texteCree = computed(() => this.compteCree()?.texte ?? '');

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
      this.envoi?.unsubscribe();
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected saisirEmail(e: Event): void {
    this.email.set((e.target as HTMLInputElement).value);
    this.erreur.set(null);
  }

  protected saisirNom(e: Event): void {
    this.nom.set((e.target as HTMLInputElement).value);
  }

  protected choisirRole(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if ((ROLES_PROPOSES as readonly string[]).includes(v)) this.role.set(v as RolePropose);
    this.erreur.set(null);
  }

  protected choisirEspace(e: Event): void {
    this.espace.set((e.target as HTMLSelectElement).value);
    this.erreur.set(null);
  }

  protected creer(): void {
    if (!this.peutCreer()) return;
    const email = this.email().trim();
    const role = this.role();
    const espaceId = this.espace() || null;
    const nomEspace = espaceId ? this.options().find((o) => o.id === espaceId)?.nom ?? null : null;
    this.enCours.set(true);
    this.erreur.set(null);
    this.envoi = this.api.creerCompte({ email, full_name: this.nom().trim() || null, role, organization_id: espaceId }).subscribe({
      next: (r) => {
        this.enCours.set(false);
        const adresse = r.email ?? email;
        this.compteCree.set({ email: adresse, lien: r.setup_link ?? null, texte: texteCompteCree(adresse, role, nomEspace) });
        this.cree.emit();
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        this.erreur.set(messageErreur(e));
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
   * - Pendant un envoi : l'écriture a pu aboutir côté serveur — `cree` est émis pour que le parent
   *   relise, puis `fermer`.
   */
  protected surFermeture(): void {
    if (this.detruit) return;
    if (this.compteCree() !== null) {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
      return;
    }
    if (this.enCours()) this.cree.emit();
    this.fermer.emit();
  }

  /** Clic sur le fond : même règle qu'Échap. */
  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement && !this.enCours() && this.compteCree() === null) this.fermer.emit();
  }
}

function texteCompteCree(email: string, role: RolePropose, nomEspace: string | null): string {
  if (nomEspace) return `${email} est membre de ${nomEspace}.`;
  return role === 'super_admin' ? `${email} est super admin, membre d'aucun espace.` : `${email} n'est membre d'aucun espace.`;
}
