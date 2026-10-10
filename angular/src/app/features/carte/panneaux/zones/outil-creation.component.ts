import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';

/**
 * Le cadre commun des trois outils de « Créer une zone » (codes postaux, rayon, dessin — lot 4, T16) : le bouton
 * repliable « <titre> ▼/▲ », le contenu propre à l'outil (projeté), puis le pied que les trois `CreerZone*.tsx`
 * recopiaient à l'identique — nom de la zone, « Créer la zone » / « Création… », bandeau d'erreur, message de
 * réussite. Styles de React (`CreerZoneCodesPostaux.tsx:126-236`).
 */
@Component({
  selector: 'mg-outil-creation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-2 block' },
  template: `
    <button
      type="button"
      data-repli
      [attr.aria-expanded]="ouvert()"
      class="w-full cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-4 py-2 text-left text-[12px] text-secondary"
      (click)="basculer.emit(!ouvert())"
    >{{ titre() }} {{ ouvert() ? '▲' : '▼' }}</button>

    @if (ouvert()) {
      <div class="mt-2 flex flex-col gap-2">
        <ng-content />

        <input
          type="text"
          data-nom
          placeholder="Nom de la zone"
          class="champ w-full rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-[7px] text-[12px] text-primary outline-none"
          [value]="nom()"
          (input)="nom.set($any($event.target).value)"
        />

        <button
          type="button"
          data-creer
          [disabled]="inactif()"
          class="w-full rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal"
          [class.cursor-pointer]="!inactif()"
          [class.cursor-not-allowed]="inactif()"
          [class.opacity-40]="inactif()"
          (click)="creer.emit()"
        >{{ enCours() ? 'Création…' : 'Créer la zone' }}</button>

        @if (erreur(); as e) {
          <div data-erreur role="alert" class="erreur rounded-[4px] px-[9px] py-[7px] text-[11px] leading-[1.5] text-danger">{{ e }}</div>
        }
        @if (message(); as m) {
          <div data-message role="status" class="succes rounded-[4px] px-[9px] py-[7px] text-[11px] leading-[1.5] text-success">{{ m }}</div>
        }
      </div>
    }
  `,
  // rgba(255,87,87,0.08/0.25) et rgba(61,255,160,0.08/0.2) de React : les jetons danger / success aux mêmes taux.
  styles: `
    .champ:focus { border-color: var(--brand-teal-50); }
    .erreur { background: color-mix(in srgb, var(--danger) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 25%, transparent); }
    .succes { background: color-mix(in srgb, var(--success) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--success) 20%, transparent); }
  `,
})
export class OutilCreationComponent {
  readonly titre = input.required<string>();
  readonly ouvert = input.required<boolean>();
  readonly nom = model('');
  readonly enCours = input(false);
  readonly inactif = input(true);
  readonly erreur = input<string | null>(null);
  readonly message = input<string | null>(null);
  /** Le bouton repliable : le parent décide (l'outil de dessin démarre ou s'arrête avec lui). */
  readonly basculer = output<boolean>();
  readonly creer = output<void>();
}
