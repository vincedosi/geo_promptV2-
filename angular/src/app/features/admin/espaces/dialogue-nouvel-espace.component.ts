import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild,
} from '@angular/core';
import type { Subscription } from 'rxjs';
import { DescriptionNonEnregistree, EspacesApi } from './data/espaces.api';
import { messageErreur } from './logique/libelles';

/** Ce que le dialogue rend au parent : l'espace créé, et si sa description a été perdue en route. */
export interface EspaceCree {
  id: string;
  descriptionPerdue: boolean;
}

let compteur = 0;

/**
 * « Nouvel espace » : `<dialog>` natif, patron de `mg-confirmation` (arbitrage C6) — `showModal()`
 * place la boîte dans la couche supérieure SANS la sortir de la racine d'ombre, rend le reste de
 * la page inerte et piège le focus.
 *
 * Le parent le monte par un `@if` et le démonte à la fermeture : chaque ouverture repart d'un
 * formulaire vide, sans remise à zéro à écrire. Le dialogue s'ouvre à son premier rendu
 * (`afterNextRender`), le nœud étant alors dans le DOM.
 *
 * Fermeture — mêmes gestes que `mg-confirmation`, sauf pendant l'envoi : Échap (l'événement
 * `cancel` est empêché, puis `annuler` émis, la touche ne remonte pas), clic sur le fond,
 * « Annuler ». Une fermeture native non empêchée émet aussi `annuler`.
 *
 * Création : `POST admin/organizations { name }`, puis `PATCH { description }` s'il y en a une.
 * Un refus (409 « Une organisation avec ce nom existe deja ») est affiché DANS le dialogue, qui
 * reste ouvert. Un PATCH en échec n'est pas un refus : l'espace existe, `creer` est émis avec
 * `descriptionPerdue: true` et le parent le dit.
 *
 * Champs en signaux + `(input)` (pas de `@angular/forms`, garde `imports-partages.test.ts`).
 */
@Component({
  selector: 'mg-dialogue-nouvel-espace',
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
      <form class="boite" novalidate (submit)="$event.preventDefault(); creerEspace()">
        <h2 [id]="idTitre" class="titre">Nouvel espace</h2>
        <label class="champ">
          <span class="libelle">Nom</span>
          <input
            data-nom
            type="text"
            autofocus
            required
            maxlength="200"
            autocomplete="off"
            placeholder="Nom de l'espace"
            [value]="nom()"
            [disabled]="enCours()"
            (input)="saisirNom($event)"
          />
        </label>
        <label class="champ">
          <span class="libelle">Description <span class="facultatif">(facultatif)</span></span>
          <textarea
            data-description
            rows="3"
            maxlength="1000"
            [value]="description()"
            [disabled]="enCours()"
            (input)="saisirDescription($event)"
          ></textarea>
        </label>
        @if (erreur(); as message) {
          <p role="alert" class="erreur">{{ message }}</p>
        }
        <div class="actions">
          <button type="button" data-annuler class="bouton annuler" [disabled]="enCours()" (click)="annuler.emit()">Annuler</button>
          <button type="submit" data-creer class="bouton creer" [disabled]="!peutCreer()">{{ libelleCreer() }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto;
      padding: 0;
      max-width: 440px;
      width: calc(100% - 32px);
      background: var(--bg-surface);
      color: inherit;
      border: 0.5px solid var(--border-default);
      border-radius: 12px;
    }
    dialog[open] { animation: entree 240ms var(--ease-out); }
    /* Voile de mg-confirmation : noir à 85 % et un flou de 4 px, dans les DEUX thèmes. */
    dialog::backdrop {
      background: color-mix(in srgb, black 85%, transparent);
      backdrop-filter: blur(4px);
      animation: voile 220ms var(--ease-out);
    }
    @keyframes entree { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes voile { from { opacity: 0; } to { opacity: 1; } }
    .boite { padding: 24px; display: flex; flex-direction: column; gap: 16px; font-family: var(--font-sans); }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); }
    .champ { display: flex; flex-direction: column; gap: 6px; }
    .libelle { font-size: 12px; color: var(--text-tertiary); }
    .facultatif { color: var(--text-tertiary); opacity: 0.8; }
    input, textarea {
      background: var(--bg-level-2);
      border: 0.5px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
      resize: vertical;
    }
    input::placeholder, textarea::placeholder { color: var(--text-tertiary); }
    input:focus, textarea:focus { border-color: var(--brand-teal-50); }
    input:disabled, textarea:disabled { opacity: 0.6; }
    .erreur {
      margin: 0;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .bouton {
      border-radius: 6px;
      padding: 9px 18px;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover),
        color 150ms var(--ease-hover), opacity 150ms var(--ease-hover), transform 160ms var(--ease-out);
    }
    .bouton:not(:disabled):active { transform: scale(0.97); }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .annuler { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .annuler:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    /* CTA principal : blanc sur noir (DESIGN_SYSTEM § 5), inversé en thème clair par les jetons ;
       survol par l'opacité comme mg-confirmation (--cta-hover, invariant, serait illisible en clair). */
    .creer { border: none; background: var(--text-primary); color: var(--bg-primary); }
    .creer:not(:disabled):hover { opacity: 0.85; }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    @media (prefers-reduced-motion: reduce) {
      dialog[open], dialog::backdrop { animation: none; }
    }
  `,
})
export class DialogueNouvelEspaceComponent {
  private readonly api = inject(EspacesApi);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private envoi: Subscription | null = null;
  /** Un `close` natif peut suivre le retrait du nœud : ne plus rien émettre une fois détruit. */
  private detruit = false;

  protected readonly idTitre = `mg-nouvel-espace-titre-${++compteur}`;
  readonly creer = output<EspaceCree>();
  readonly annuler = output<void>();

  protected readonly nom = signal('');
  protected readonly description = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);

  protected readonly peutCreer = computed(() => this.nom().trim() !== '' && !this.enCours());
  protected readonly libelleCreer = computed(() => (this.enCours() ? 'Création…' : 'Créer l\'espace'));

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    // Démonté pendant l'envoi : la réponse est ignorée (le serveur, lui, a pu créer l'espace —
    // la liste relue par le parent le montrera).
    // Fermeture explicite AVANT le retrait du nœud : le navigateur rend alors le focus à
    // l'élément qui l'avait (« + Nouvel espace ») ; un simple retrait du DOM ne le fait pas.
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.envoi?.unsubscribe();
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected saisirNom(e: Event): void {
    this.nom.set((e.target as HTMLInputElement).value);
    this.erreur.set(null);
  }

  protected saisirDescription(e: Event): void {
    this.description.set((e.target as HTMLTextAreaElement).value);
  }

  protected creerEspace(): void {
    if (!this.peutCreer()) return;
    const nom = this.nom().trim();
    const description = this.description().trim() || null;
    this.enCours.set(true);
    this.erreur.set(null);
    this.envoi = this.api.creerEspace(nom, description).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.creer.emit({ id: r.organization.id, descriptionPerdue: false });
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        if (e instanceof DescriptionNonEnregistree) {
          this.creer.emit({ id: e.id, descriptionPerdue: true });
          return;
        }
        this.erreur.set(messageErreur(e));
      },
    });
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    if (!this.enCours()) this.annuler.emit();
  }

  protected surFermeture(): void {
    if (!this.detruit) this.annuler.emit();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement && !this.enCours()) this.annuler.emit();
  }
}
