import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, viewChild,
} from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import type { ZoneAdmin } from '../data/sources-admin.api';

let compteur = 0;

/**
 * Confirmation de suppression d'une zone perso — portage de `ZoneAdminDeleteDialog.tsx` (lot 6, T20).
 *
 * `<dialog>` natif (C6) au lieu du voile `position: fixed` de React (interdit dans une racine d'ombre) :
 * `showModal()` le place dans la couche supérieure SANS le sortir de l'ombre. Monté par le parent (`@if`)
 * tant qu'une zone est visée, ouvert à son premier rendu.
 *
 * Fermeture : « Annuler », et Échap (geste natif du `<dialog>` : React n'en avait aucun, son voile
 * n'écoutait rien) — l'un et l'autre refusés pendant la suppression. Un clic sur le fond NE ferme PAS,
 * comme React.
 *
 * L'erreur de suppression (React : un toast `position: fixed` en bas à droite, `index.tsx:131-144`) est
 * affichée DANS la boîte : elle n'existe que pendant que le dialogue est ouvert (React l'efface à
 * l'annulation et le dialogue reste ouvert après un échec), et un élément de la page, même `sticky` ou
 * `absolute`, serait sous le voile du `<dialog>` modal, inerte et masqué (ruling T20, C6 étendu).
 *
 * Couleurs (C9) : voile `rgba(0,0,0,0.6)` → noir à 60 % ; `rgba(255,87,87,0.06|0.2)` → `--danger` à
 * 6 % / 20 % ; texte du bouton rouge `#050505` → `--bg-primary` (identique en sombre ; blanc sur le
 * rouge du thème clair, plus lisible que le noir de React).
 */
@Component({
  selector: 'mg-dialogue-suppression-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogue
      [attr.aria-labelledby]="idTitre"
      (cancel)="surAnnulationNative($event)"
      (close)="surFermeture()"
      (keydown.escape)="$event.stopPropagation()"
    >
      <div class="boite">
        <div [id]="idTitre" class="titre" data-titre>Supprimer "{{ zone().name }}" ?</div>
        <div class="details" data-details>
          <div>Workspace : {{ zone().org_name ?? '—' }}</div>
          <div>Source : {{ zone().source_type }}</div>
          <div>Features : {{ features() }}</div>
        </div>
        <div class="avertissement" data-avertissement>
          ⚠️ Action irréversible. Les users de ce workspace ne pourront plus utiliser cette zone dans leurs analyses.
          Les campagnes qui la référencent continueront de fonctionner (l'agrégation est déjà calculée).
        </div>
        @if (erreur(); as e) {
          <div class="erreur" role="alert" data-erreur-suppression>{{ e }}</div>
        }
        <div class="actions">
          <button type="button" class="bouton annuler" data-annuler [disabled]="enCours()" (click)="annuler.emit()">Annuler</button>
          <button type="button" class="bouton confirmer" data-confirmer [disabled]="enCours()" (click)="confirmer.emit()">
            {{ enCours() ? 'Suppression...' : 'Supprimer definitivement' }}
          </button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; width: 460px; max-width: 90vw; background: var(--bg-surface); color: inherit;
      border: 0.5px solid var(--border-subtle); border-radius: 8px;
    }
    dialog::backdrop { background: color-mix(in srgb, black 60%, transparent); }
    .boite { padding: 24px; }
    .titre { font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
    .details { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); line-height: 1.8; margin-bottom: 16px; }
    .avertissement {
      background: color-mix(in srgb, var(--danger) 6%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
      border-radius: 4px; padding: 10px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); line-height: 1.5;
      margin-bottom: 20px;
    }
    /* Le toast d'erreur de React (bord --danger, texte --danger, 12 px), placé dans la boîte. */
    .erreur {
      margin: -8px 0 16px; padding: 10px 14px; background: var(--bg-surface); border: 0.5px solid var(--danger); border-radius: 4px;
      color: var(--danger-texte); font-family: var(--font-sans); font-size: 12px;
    }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
    .bouton { font-family: var(--font-sans); font-size: 12px; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .annuler { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .confirmer { background: var(--danger); border: none; color: var(--bg-primary); font-weight: 500; }
  `,
})
export class DialogueSuppressionZoneComponent {
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private detruit = false;

  protected readonly idTitre = `mg-suppression-zone-titre-${++compteur}`;
  readonly zone = input.required<ZoneAdmin>();
  readonly enCours = input(false);
  readonly erreur = input<string | null>(null);
  readonly confirmer = output<void>();
  readonly annuler = output<void>();

  protected readonly features = computed(() => {
    const z = this.zone();
    return `${formaterNombre(z.feature_count_iris)} IRIS · ${formaterNombre(z.feature_count_cp)} CP`;
  });

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    if (!this.enCours()) this.annuler.emit();
  }

  /** Fermeture native non empêchée : pendant la suppression le dialogue est rouvert, sinon `annuler` resynchronise. */
  protected surFermeture(): void {
    if (this.detruit) return;
    if (this.enCours()) this.dialogue().nativeElement.showModal();
    else this.annuler.emit();
  }
}
