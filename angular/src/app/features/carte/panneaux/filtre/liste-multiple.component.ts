import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input,
  output, signal, viewChild,
} from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';

/** Un élément de la liste : son code et son libellé. */
export interface ElementListe {
  readonly id: string;
  readonly label: string;
}

/**
 * Liste déroulante à sélection multiple, avec recherche — portage de
 * `app/map/_components/filter-panel/MultiDropdown.tsx`.
 *
 * La liste s'ouvre SOUS le bouton, en `absolute` dans le flux du panneau (comme React : `position: absolute`,
 * `top: 100%`, `z-index: 300`) — pas de portail, donc rien hors de la racine d'ombre.
 *
 * Fermeture au clic extérieur : React écoute `document` ; ici la RACINE qui porte le composant (la racine
 * d'ombre de MAGELIAN, ou le document en test), avec `composedPath()` — jamais le document du shell (B10).
 * Conséquence assumée : un clic dans le shell, hors de MAGELIAN, ne referme pas la liste.
 *
 * Textes, tailles et couleurs repris tels quels (y compris « selectionnes » sans accent, comme React).
 */
@Component({
  selector: 'mg-liste-multiple',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fpDropIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .deroulant { animation: fpDropIn 180ms var(--ease-out); }
  `,
  host: { class: 'relative block' },
  template: `
    <button
      type="button"
      data-declencheur
      [attr.aria-expanded]="ouvert()"
      (click)="basculer()"
      class="flex w-full cursor-pointer items-center justify-between rounded-[4px] border-fin bg-elevated px-[11px] py-2 text-[13px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
      [class.border-hover]="ouvert()"
      [class.border-subtle]="!ouvert()"
      [class.text-primary]="selection().length > 0"
      [class.text-tertiary]="selection().length === 0"
    >
      <span class="truncate">{{ libelleAffiche() }}</span>
      <span class="ml-2 flex shrink-0 items-center gap-1">
        @if (selection().length > 0) {
          <span
            data-effacer
            title="Effacer"
            (click)="effacer($event)"
            class="cursor-pointer px-[2px] text-[11px] leading-none text-tertiary"
          >✕</span>
        }
        <span class="text-[9px] text-tertiary">{{ ouvert() ? '▲' : '▼' }}</span>
      </span>
    </button>

    @if (ouvert()) {
      <div
        data-deroulant
        class="deroulant absolute left-0 right-0 top-full z-[300] flex max-h-[260px] flex-col rounded-b-[4px] border-fin border-t-0 border-default bg-elevated"
      >
        @if (rechercheVisible()) {
          <div class="flex shrink-0 items-center gap-1.5 border-b-fin border-subtle px-2 py-[5px]">
            <mg-icone nom="loupe" [taille]="12" class="shrink-0 text-tertiary" />
            <input
              #champ
              data-recherche
              aria-label="Rechercher"
              placeholder="Rechercher..."
              [value]="recherche()"
              (input)="recherche.set($any($event.target).value)"
              class="w-full border-0 bg-transparent text-[12px] text-primary outline-none"
            />
            @if (recherche()) {
              <button
                type="button"
                aria-label="Effacer la recherche"
                (click)="recherche.set('')"
                class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[10px] leading-none text-tertiary"
              >✕</button>
            }
          </div>
        }
        <div class="flex shrink-0 justify-between border-b-fin border-subtle px-2 py-1">
          <button
            type="button"
            data-tout
            (click)="toutBasculer()"
            class="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-teal"
          >{{ libelleTout() }}</button>
          <span class="font-mono text-[10px] text-tertiary">{{ selection().length }}/{{ items().length }}</span>
        </div>
        <div class="flex-1 overflow-y-auto">
          @if (filtres().length === 0) {
            <div class="px-[11px] py-2 text-[12px] text-tertiary">Aucun resultat</div>
          }
          @for (item of filtres(); track item.id) {
            <button
              type="button"
              [attr.data-element]="item.id"
              [attr.aria-pressed]="actifs().has(item.id)"
              (click)="basculerElement(item.id)"
              class="flex w-full cursor-pointer items-center gap-[9px] border-0 border-b-fin border-subtle px-[11px] py-1.5 text-left"
              [class]="actifs().has(item.id) ? classeActif : classeInactif"
            >
              <span
                class="flex size-3 shrink-0 items-center justify-center rounded-[2px] border-fin"
                [class.border-teal]="actifs().has(item.id)"
                [class.bg-teal]="actifs().has(item.id)"
                [class.border-default]="!actifs().has(item.id)"
              >
                @if (actifs().has(item.id)) {
                  <span class="text-[8px] font-bold text-[var(--bg-primary)]">✓</span>
                }
              </span>
              <span
                class="truncate text-[12px]"
                [class.text-primary]="actifs().has(item.id)"
                [class.text-secondary]="!actifs().has(item.id)"
              >{{ item.label }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class ListeMultipleComponent {
  /** Libellé du bouton quand rien n'est choisi. */
  readonly libelle = input.required<string>();
  readonly items = input.required<readonly ElementListe[]>();
  readonly selection = input.required<readonly string[]>();
  /** Recherche forcée ; elle s'affiche de toute façon au-delà de 10 éléments (`MultiDropdown.tsx:26`). */
  readonly recherchable = input(false);
  readonly changer = output<string[]>();

  protected readonly ouvert = signal(false);
  protected readonly recherche = signal('');
  private readonly champ = viewChild<ElementRef<HTMLInputElement>>('champ');
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);

  // React : actif `rgba(78,205,196,0.06)` (le teal est invariant, donc exact), survol `rgba(255,255,255,0.04)`.
  // Le survol passe par `--text-primary` à 4 % (T6, règle « jamais de couleur en dur ») : quasi identique en sombre
  // (#f0f0f0 contre #fff), et VISIBLE en clair, où un voile blanc sur fond clair ne se voyait pas.
  protected readonly classeActif = 'bg-[color-mix(in_srgb,var(--brand-teal)_6%,transparent)]';
  protected readonly classeInactif = 'bg-transparent hover:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)]';

  protected readonly rechercheVisible = computed(() => this.recherchable() || this.items().length > 10);
  protected readonly filtres = computed(() => {
    const q = this.recherche().toLowerCase();
    if (!this.rechercheVisible() || !q) return this.items();
    return this.items().filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  });
  protected readonly actifs = computed(() => new Set(this.selection()));
  private readonly toutFiltreChoisi = computed(() => {
    const f = this.filtres();
    const a = this.actifs();
    return f.length > 0 && f.every((i) => a.has(i.id));
  });
  protected readonly libelleTout = computed(() =>
    this.toutFiltreChoisi()
      ? 'Tout deselectionner'
      : `Tout selectionner${this.recherche() ? ` (${this.filtres().length})` : ''}`,
  );
  protected readonly libelleAffiche = computed(() => {
    const s = this.selection();
    if (s.length === 0) return this.libelle();
    if (s.length === 1) return this.items().find((i) => i.id === s[0])?.label ?? s[0];
    return `${s.length} / ${this.items().length} selectionnes`;
  });

  constructor() {
    // `autoFocus` du champ de recherche à l'ouverture.
    afterRenderEffect(() => {
      const champ = this.champ();
      if (this.ouvert() && champ) champ.nativeElement.focus({ preventScroll: true });
    });
    // Clic extérieur : écouté sur la racine qui porte le composant, jamais sur le document du shell. Lue APRÈS le
    // premier rendu : dans le constructeur, l'hôte n'est pas encore rattaché à sa racine.
    const appui = (e: Event) => {
      if (!e.composedPath().includes(this.hote.nativeElement)) this.ouvert.set(false);
    };
    let racine: Document | ShadowRoot | null = null;
    afterNextRender(() => {
      racine = this.hote.nativeElement.getRootNode() as Document | ShadowRoot;
      racine.addEventListener('mousedown', appui);
    });
    inject(DestroyRef).onDestroy(() => racine?.removeEventListener('mousedown', appui));
  }

  protected basculer(): void {
    this.ouvert.update((o) => !o);
  }

  protected effacer(e: Event): void {
    e.stopPropagation();
    this.changer.emit([]);
  }

  protected basculerElement(id: string): void {
    const s = this.selection();
    this.changer.emit(s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  protected toutBasculer(): void {
    const f = this.filtres();
    if (this.toutFiltreChoisi()) {
      const retirer = new Set(f.map((i) => i.id));
      this.changer.emit(this.selection().filter((id) => !retirer.has(id)));
    } else {
      const ids = new Set(this.selection());
      for (const i of f) ids.add(i.id);
      this.changer.emit([...ids]);
    }
  }
}
