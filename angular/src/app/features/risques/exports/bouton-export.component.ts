import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { type Observable, type Subscription, finalize } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { IconeComponent } from '../../../ui/icone/icone.component';

/** Message générique quand le corps d'erreur n'est pas lisible (`BoutonExportRayon.tsx:49`). */
export const MESSAGE_EXPORT_IMPOSSIBLE = 'Export impossible.';
/** La requête n'a pas abouti du tout (`BoutonExportRayon.tsx:68`). */
export const MESSAGE_EXPORT_SANS_REPONSE = 'L’export n’a pas répondu.';

/**
 * Le message d'un export refusé : le champ `error` du JSON rendu par la route, sinon le message générique.
 * `HttpClient` en `responseType: 'blob'` livre aussi le corps d'ERREUR en `Blob` : on le lit comme du texte, jamais
 * comme un classeur (React : « une erreur JSON est lue et affichée plutôt que téléchargée comme un .xlsx illisible »).
 */
export async function messageExport(erreur: unknown): Promise<string> {
  if (!(erreur instanceof HttpErrorResponse) || erreur.status === 0) return MESSAGE_EXPORT_SANS_REPONSE;
  const corps: unknown = erreur.error;
  let texte: string | null = null;
  if (corps instanceof Blob) texte = await corps.text().catch(() => null);
  else if (typeof corps === 'string') texte = corps;
  else if (corps && typeof corps === 'object' && typeof (corps as { error?: unknown }).error === 'string') {
    return (corps as { error: string }).error;
  }
  if (!texte) return MESSAGE_EXPORT_IMPOSSIBLE;
  try {
    const lu = JSON.parse(texte) as { error?: unknown };
    return typeof lu.error === 'string' && lu.error ? lu.error : MESSAGE_EXPORT_IMPOSSIBLE;
  } catch {
    return MESSAGE_EXPORT_IMPOSSIBLE; // le corps n'était pas du JSON : on garde le message générique
  }
}

/**
 * Un bouton de téléchargement d'un classeur — portage GÉNÉRIQUE de `BoutonExportRayon.tsx` et
 * `BoutonExportProfil.tsx`, qui partageaient le même patron.
 *
 * ── LE FICHIER PASSE PAR `HttpClient`, JAMAIS PAR UN `<a href>` (A8) ─────
 *
 * `charger` rend la réponse en `blob` d'un service d'API : le jeton (`jetonInterceptor`), le limiteur des trois appels
 * simultanés et l'intercepteur de session s'appliquent donc d'office. Le nom du fichier vient de `Content-Disposition`
 * (`nomDeFichier`), `nomRepli` sinon. L'ancre de téléchargement n'est jamais posée dans `document.body`
 * (`enregistrerFichier`) : rien ne s'affiche hors de la racine d'ombre.
 *
 * Pendant l'export : bouton désactivé, icône qui tourne, `libelleEnCours`. Un échec affiche le message de la route à
 * côté du bouton, en rouge ; un nouveau clic l'efface.
 */
@Component({
  selector: 'mg-bouton-export',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2' },
  template: `
    <button type="button" (click)="exporter()" [disabled]="enCours() || desactive()" [attr.title]="titre()"
            [attr.aria-busy]="enCours()"
            class="inline-flex items-center bg-transparent text-[12px] whitespace-nowrap"
            [class.border-fin]="variante() !== 'lien'" [class.border-0]="variante() === 'lien'"
            [class.p-0]="variante() === 'lien'" [class.gap-[5px]]="variante() === 'lien'"
            [class.font-sans]="variante() === 'lien'"
            [class.text-teal]="variante() === 'teal' || variante() === 'lien'"
            [class.gap-[6px]]="variante() === 'teal' || variante() === 'neutre'"
            [class.rounded-lg]="variante() === 'teal' || variante() === 'neutre'"
            [class.px-3]="variante() === 'teal' || variante() === 'neutre'"
            [class.py-[5px]]="variante() === 'teal'" [class.py-[6px]]="variante() === 'neutre'"
            [class.gap-[7px]]="variante() === 'action'" [class.rounded-[6px]]="variante() === 'action'"
            [class.px-4]="variante() === 'action'" [class.py-2]="variante() === 'action'"
            [class.border-teal]="variante() === 'teal'"
            [class.font-medium]="variante() === 'teal'"
            [class.border-default]="variante() === 'neutre' || variante() === 'action'"
            [class.text-secondary]="(variante() === 'neutre' || variante() === 'action') && !desactive()"
            [class.text-tertiary]="(variante() === 'neutre' || variante() === 'action') && desactive()"
            [class.cursor-pointer]="!enCours() && !desactive()"
            [class.cursor-wait]="enCours() && (variante() === 'teal' || variante() === 'lien')"
            [class.cursor-not-allowed]="desactive() || (enCours() && variante() !== 'teal' && variante() !== 'lien')">
      @if (enCours()) {
        <mg-icone nom="chargement" [taille]="tailleIcone()" class="animate-spin" />
      } @else {
        <mg-icone nom="telecharger" [taille]="tailleIcone()" />
      }
      {{ enCours() ? (libelleEnCours() ?? libelle()) : libelle() }}
    </button>
    @if (message(); as m) {
      <span role="alert" class="text-[11px] text-danger">{{ m }}</span>
    }
  `,
})
export class BoutonExportComponent {
  readonly libelle = input.required<string>();
  /** La requête du classeur : un `get(…, { observe: 'response', responseType: 'blob' })` d'un service d'API. */
  readonly charger = input.required<() => Observable<HttpResponse<Blob>>>();
  /** Nom du fichier quand la réponse ne porte pas de `Content-Disposition`. */
  readonly nomRepli = input.required<string>();
  /** Libellé pendant l'export (« Préparation… » pour le rayon) ; défaut, le libellé lui-même (profil). */
  readonly libelleEnCours = input<string>();
  readonly titre = input<string>();
  /**
   * `teal` : bouton d'action du rayon ; `neutre` : bouton de l'en-tête (profil) ; `action` : bouton neutre d'une
   * rangée d'actions de panneau (`styleBoutonNeutre` d'`OngletZones.tsx:820` — 8 × 16 px, rayon 6, écart 7) ; `lien` :
   * lien teal sans cadre d'une ligne de tableau (`styleLien` de `PanneauExtractions.tsx` — icône 12, écart 5).
   */
  readonly variante = input<'teal' | 'neutre' | 'action' | 'lien'>('teal');
  protected readonly tailleIcone = computed(() => (this.variante() === 'lien' ? 12 : 13));
  /** Désactivé avant toute requête (profil sans anneau : le classeur serait vide). */
  readonly desactive = input(false, { transform: booleanAttribute });

  protected readonly enCours = signal(false);
  protected readonly message = signal<string | null>(null);

  private readonly doc = inject(DOCUMENT);
  private readonly enregistrer = inject(ENREGISTRER_FICHIER);
  private abonnement: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  protected exporter(): void {
    if (this.enCours() || this.desactive()) return;
    this.enCours.set(true);
    this.message.set(null);
    this.abonnement?.unsubscribe();
    // `finalize` : le bouton se réarme quoi qu'il arrive — réponse, erreur, ou enregistrement qui lève.
    this.abonnement = this.charger()().pipe(finalize(() => this.enCours.set(false))).subscribe({
      next: (reponse) => {
        // Un enregistrement qui LÈVE (fichier illisible, navigateur qui refuse) ne doit pas laisser le bouton bloqué
        // sur « Préparation… » sans rien dire (relecture T10).
        try {
          this.enregistrer(this.doc, reponse, this.nomRepli());
        } catch {
          this.message.set(MESSAGE_EXPORT_SANS_REPONSE);
        }
      },
      error: (e: unknown) => {
        void messageExport(e).then((m) => this.message.set(m));
      },
    });
  }
}
