import { ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { RadioApi, type StationRadio } from '../../data/radio.api';

/** L'attente avant d'interroger les stations, et le nombre de caractères minimal (`RadioSearchInput.tsx:14-15`). */
export const DELAI_RECHERCHE_RADIO_MS = 300;
export const CARACTERES_MIN_RADIO = 2;
/** La liste se ferme 200 ms après la perte du focus : le temps qu'un clic sur une station soit pris (`:41`). */
export const DELAI_FERMETURE_MS = 200;

/**
 * L'autocomplétion de station radio — portage de `filter-panel/RadioSearchInput.tsx`.
 *
 * Anti-rebond de 300 ms, deux caractères au moins, 8 stations au plus. Une station se choisit au `mousedown` (avant que
 * le champ perde le focus). La liste s'ouvre SOUS le champ, en `absolute` dans le flux du panneau — aucun portail.
 * Comme React, un échec de recherche est tu : la liste ne s'ouvre pas.
 */
@Component({
  selector: 'mg-recherche-radio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block' },
  template: `
    <input
      data-recherche-radio
      aria-label="Rechercher une radio"
      placeholder="Ex: NRJ, France Inter..."
      [value]="requete()"
      (input)="chercher($any($event.target).value)"
      (focus)="focus()"
      (blur)="quitter()"
      class="w-full rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-1.5 text-[11px] text-primary outline-none transition-[border-color] duration-150 ease-[var(--ease-hover)] placeholder:text-tertiary focus:border-[var(--brand-teal-50)]"
    />
    @if (ouverte() && resultats().length > 0) {
      <div data-resultats-radio class="absolute left-0 right-0 top-full z-20 mt-1 max-h-[200px] overflow-y-auto rounded-[6px] border-fin border-default bg-surface">
        @for (r of resultats(); track r.id) {
          <button type="button" [attr.data-station]="r.id" (mousedown)="choisir(r)"
            class="block w-full cursor-pointer border-0 bg-transparent px-[10px] py-1.5 text-left text-[11px] text-primary transition-[background-color] duration-150 ease-[var(--ease-hover)] hover:bg-elevated">
            {{ r.nom }} @if (r.categorie_arcom) {<span class="text-[10px] text-tertiary">({{ r.categorie_arcom }})</span>}
          </button>
        }
      </div>
    }
  `,
})
export class RechercheRadioComponent {
  /** La station choisie : son id et son nom. */
  readonly choisie = output<{ id: string; nom: string }>();

  private readonly api = inject(RadioApi);
  protected readonly requete = signal('');
  protected readonly resultats = signal<StationRadio[]>([]);
  protected readonly ouverte = signal(false);
  private minuterie: ReturnType<typeof setTimeout> | undefined;
  private fermeture: ReturnType<typeof setTimeout> | undefined;
  private lecture: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.minuterie);
      clearTimeout(this.fermeture);
      this.lecture?.unsubscribe();
    });
  }

  protected chercher(q: string): void {
    this.requete.set(q);
    clearTimeout(this.minuterie);
    if (q.length < CARACTERES_MIN_RADIO) {
      this.resultats.set([]);
      this.ouverte.set(false);
      return;
    }
    this.minuterie = setTimeout(() => {
      this.lecture?.unsubscribe();
      this.lecture = this.api.stations(q).subscribe({
        next: (d) => {
          this.resultats.set(d.stations ?? []);
          this.ouverte.set(true);
        },
        error: () => undefined,
      });
    }, DELAI_RECHERCHE_RADIO_MS);
  }

  protected focus(): void {
    if (this.resultats().length) this.ouverte.set(true);
  }

  protected quitter(): void {
    clearTimeout(this.fermeture);
    this.fermeture = setTimeout(() => this.ouverte.set(false), DELAI_FERMETURE_MS);
  }

  protected choisir(r: StationRadio): void {
    this.choisie.emit({ id: r.id, nom: r.nom });
    this.requete.set(r.nom);
    this.ouverte.set(false);
  }
}
