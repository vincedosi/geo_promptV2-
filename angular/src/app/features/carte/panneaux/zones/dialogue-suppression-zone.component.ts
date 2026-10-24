import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';

/** Identifiants uniques des titres (`aria-labelledby`). */
let compteur = 0;

/**
 * « Supprimer la zone » — `ZoneDeleteDialog` (`app/map/custom-geo/_components/ZoneDeleteDialog.tsx`), textes exacts.
 *
 * `<dialog>` natif (B13) dans l'arbre de la racine d'ombre, jamais le voile `position: fixed` de React. Le parent
 * fournit `confirmer` : une promesse qui rend `null` si la suppression a réussi (il ferme alors le dialogue), ou le
 * message d'échec, affiché DANS le dialogue (React : « plutôt qu'échouer silencieusement »).
 *
 * Fermeture : Annuler, clic sur le voile, Échap — sauf pendant la suppression, comme React (`!deleting && onClose()`).
 * L'Échap est CONSOMMÉ : il ferme le dialogue, pas aussi le panneau derrière.
 */
@Component({
  selector: 'mg-dialogue-suppression-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialogue [attr.aria-labelledby]="idTitre" (cancel)="surAnnulation($event)" (keydown.escape)="echap($event)" (click)="surClic($event)">
      <div [id]="idTitre" class="border-b-fin border-subtle px-5 py-3.5 text-[14px] font-semibold text-danger">{{ titre() }}</div>
      <div class="p-5 text-[13px] leading-[1.6] text-secondary">
        Supprimer <strong class="text-primary">{{ nom() }}</strong> ?
        {{ texte() }}
        @if (erreur(); as e) {
          <div data-erreur role="alert" class="alerte mt-3 rounded-[4px] px-3 py-2 text-[12px] text-danger">{{ e }}</div>
        }
      </div>
      <div class="flex justify-end gap-2 border-t-fin border-subtle px-5 py-3">
        <button type="button" data-annuler class="bouton border-fin border-default bg-transparent text-secondary" [disabled]="enCours()" (click)="fermer.emit()">Annuler</button>
        <button type="button" data-confirmer class="bouton danger font-medium text-danger" [disabled]="enCours()" (click)="supprimer()">
          {{ enCours() ? 'Suppression...' : 'Supprimer' }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; width: 380px; max-width: calc(100% - 32px);
      background: var(--bg-level-2); color: var(--text-primary); border: 0.5px solid var(--border-default); border-radius: 10px;
      font-family: var(--font-sans);
    }
    /* Le voile de React (rgba(0,0,0,0.7)) : noir dans les deux thèmes, comme lui (même règle que le dialogue météo). */
    dialog::backdrop { background: color-mix(in srgb, black 70%, transparent); }
    .bouton { padding: 8px 16px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .bouton:disabled { cursor: not-allowed; }
    /* rgba(255,87,87,0.1 / 0.3) : le jeton danger à 10 et 30 % (identique en sombre, assombri en clair comme --danger). */
    .danger { background: color-mix(in srgb, var(--danger) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 30%, transparent); }
    .alerte { background: color-mix(in srgb, var(--danger) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 25%, transparent); }
  `,
})
export class DialogueSuppressionZoneComponent {
  /** Le nom de la zone à supprimer. */
  readonly nom = input.required<string>();
  /** Titre et avertissement : ceux d'une zone par défaut ; la bibliothèque de ⑤ (lot 5, T12) y supprime un JEU. */
  readonly titre = input('Supprimer la zone');
  readonly texte = input('Cette action est irreversible. Les codes IRIS et CP resolus seront aussi supprimes.');
  /** La suppression : `null` si elle a réussi, le message d'échec sinon. */
  readonly confirmer = input.required<() => Promise<string | null>>();
  readonly fermer = output<void>();

  protected readonly idTitre = `mg-suppression-zone-${++compteur}`;
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(DestroyRef).onDestroy(() => {
      const d = hote.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected async supprimer(): Promise<void> {
    this.enCours.set(true);
    this.erreur.set(null);
    const echec = await this.confirmer()();
    this.enCours.set(false);
    if (echec) this.erreur.set(echec);
  }

  /** Échap : consommé (le panneau derrière reste ouvert), ignoré pendant la suppression. */
  protected echap(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.enCours()) this.fermer.emit();
  }

  /** Fermeture native (Échap traité par le navigateur seul) : on garde la main, le parent décide. */
  protected surAnnulation(e: Event): void {
    e.preventDefault();
    if (!this.enCours()) this.fermer.emit();
  }

  /** Le voile : un clic dont la cible est le `<dialog>` lui-même, hors de son contenu. */
  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement && !this.enCours()) this.fermer.emit();
  }
}
