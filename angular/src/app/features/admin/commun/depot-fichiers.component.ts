import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

/**
 * Zone de dépôt de fichiers : glisser-déposer + `<input type="file">` caché, cadre des zones de
 * `import/_components/UploadStep.tsx:59-75` et `dashboard/iris-crawler/page.tsx:182-201`
 * (tirets de 2 px, rayon 2, teal au survol). Le contenu (consignes, nom du fichier choisi) est
 * PROJETÉ : il diffère d'un écran à l'autre. `survol` est public pour qu'il puisse s'en servir
 * (`#depot` puis `depot.survol()`).
 *
 * N'écoute `dragover`/`drop` que sur elle-même, jamais sur `document`. Sans `multiple`, seul le
 * premier fichier déposé est émis (`dataTransfer.files[0]`, iris-crawler). Le champ est vidé après
 * chaque choix pour qu'on puisse re-choisir le même fichier.
 *
 * Écart à React, voulu : la zone est focalisable et s'ouvre au clavier (Entrée, Espace) — le `div`
 * de React ne l'était pas.
 */
@Component({
  selector: 'mg-depot-fichiers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      data-zone
      role="button"
      [attr.tabindex]="desactive() ? -1 : 0"
      [attr.aria-disabled]="desactive()"
      class="zone"
      [class.survol]="survol()"
      [class.desactive]="desactive()"
      [class.fond-surface]="fondRepos() === 'surface'"
      [class.fond-eleve]="fondRepos() === 'eleve'"
      [style.padding]="marge()"
      (click)="ouvrir()"
      (keydown.enter)="ouvrir(); $event.preventDefault()"
      (keydown.space)="ouvrir(); $event.preventDefault()"
      (dragover)="surSurvol($event)"
      (dragleave)="survol.set(false)"
      (drop)="surDepot($event)"
    >
      <input
        #champ
        type="file"
        class="hidden"
        tabindex="-1"
        [attr.accept]="accepter() ?? null"
        [multiple]="multiple()"
        (click)="$event.stopPropagation()"
        (change)="surChoix()"
      />
      <ng-content />
    </div>
  `,
  styles: `
    .zone {
      border: 2px dashed var(--border-subtle);
      border-radius: 2px;
      text-align: center;
      cursor: pointer;
      background: transparent;
      transition: all 0.15s ease;
    }
    .zone.fond-surface { background: var(--bg-surface); }
    .zone.fond-eleve { background: var(--bg-level-2); }
    .zone.survol { border-color: var(--brand-teal); background: var(--brand-teal-10); }
    .zone.desactive { cursor: not-allowed; opacity: 0.5; }
  `,
})
export class DepotFichiersComponent {
  /** Attribut `accept` du champ fichier. */
  readonly accepter = input<string>();
  readonly multiple = input(false);
  readonly desactive = input(false);
  /**
   * Fond au repos : transparent (import POI), surface, ou élevé (`--bg-level-2` : IRIS crawler, dont le
   * `C.bgElevated` vaut `var(--bg-level-2)`, `iris-crawler/page.tsx:9,192` — constaté en T15).
   */
  readonly fondRepos = input<'transparent' | 'surface' | 'eleve'>('transparent');
  /** Marge intérieure CSS : `28px 20px` (import POI), `40px 20px` (IRIS crawler). */
  readonly marge = input('28px 20px');
  readonly fichiers = output<File[]>();

  /** Un glisser survole la zone. */
  readonly survol = signal(false);

  private readonly champ = viewChild.required<ElementRef<HTMLInputElement>>('champ');

  protected ouvrir(): void {
    if (this.desactive()) return;
    this.champ().nativeElement.click();
  }

  protected surSurvol(e: DragEvent): void {
    e.preventDefault();
    if (!this.desactive()) this.survol.set(true);
  }

  protected surDepot(e: DragEvent): void {
    e.preventDefault();
    this.survol.set(false);
    if (this.desactive()) return;
    this.emettre(e.dataTransfer?.files ?? null);
  }

  protected surChoix(): void {
    const champ = this.champ().nativeElement;
    this.emettre(champ.files);
    champ.value = '';
  }

  private emettre(liste: FileList | ArrayLike<File> | null): void {
    const tous = liste ? Array.from(liste) : [];
    if (tous.length === 0) return;
    this.fichiers.emit(this.multiple() ? tous : [tous[0]]);
  }
}
