import type { HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { BoutonExportComponent } from '../../exports/bouton-export.component';

const SAISIE = 'rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-[13px] text-primary';

/**
 * Nommer, enregistrer, reconstruire, exporter — portage d'`Actions` (`OngletZones.tsx:580-652`).
 *
 * Un BROUILLON porte les champs de nom et le bouton « Enregistrer le jeu » ; un jeu enregistré, « Dupliquer depuis le
 * profil courant » et l'export. L'export passe par `mg-bouton-export` (A8) : React posait un `<a href>` vers une route
 * qui ne lit que l'en-tête `Authorization`, donc partait sans jeton.
 */
@Component({
  selector: 'mg-actions-jeu',
  imports: [BoutonExportComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (brouillon()) {
      <div class="flex flex-wrap gap-[10px]">
        <input [value]="nom()" (input)="nom.set(texte($event))" placeholder="Nom du jeu de zones"
               aria-label="Nom du jeu de zones" [class]="saisie + ' flex-[1_1_220px]'" />
        <input [value]="description()" (input)="description.set(texte($event))"
               placeholder="À quoi sert ce jeu (facultatif)" aria-label="Description du jeu de zones"
               [class]="saisie + ' flex-[2_1_280px]'" />
      </div>
    }
    <div class="flex flex-wrap items-center gap-[10px]">
      @if (brouillon()) {
        <button type="button" data-role="enregistrer" [disabled]="bloque()" (click)="enregistrerJeu()"
                class="inline-flex items-center gap-[7px] rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal"
                [class.opacity-50]="bloque()" [class.cursor-not-allowed]="bloque()" [class.cursor-pointer]="!bloque()">
          @if (enCours()) {
            <mg-icone nom="chargement" [taille]="13" class="animate-spin" />
          } @else {
            <mg-icone nom="enregistrer" [taille]="13" />
          }
          Enregistrer le jeu
        </button>
      }
      <button type="button" data-role="dupliquer" (click)="dupliquer.emit()"
              class="inline-flex cursor-pointer items-center gap-[7px] rounded-[6px] border-fin border-default bg-transparent px-4 py-2 text-[12px] text-secondary">
        <mg-icone nom="copier" [taille]="13" />
        {{ brouillon() ? 'Reconstruire' : 'Dupliquer depuis le profil courant' }}
      </button>
      @if (exporter(); as charger) {
        <mg-bouton-export libelle="Exporter (Excel)" nomRepli="jeu-de-zones.xlsx" variante="action" [charger]="charger" />
      }
    </div>
    @if (erreur(); as e) {
      <p role="status" class="m-0 rounded-[6px] border-fin border-danger/20 bg-danger/10 px-3 py-2 text-[12px] leading-[1.5] text-danger">{{ e }}</p>
    }
  `,
})
export class ActionsJeuComponent {
  readonly brouillon = input.required<boolean>();
  readonly nom = model.required<string>();
  readonly description = model.required<string>();
  /** L'enregistrement, attendu : le bouton reste désactivé, icône qui tourne, jusqu'à la réponse. */
  readonly enregistrer = input.required<() => Promise<unknown>>();
  /** La requête du classeur, `null` tant que le jeu est un brouillon : on n'exporte pas un sans-nom. */
  readonly exporter = input<(() => Observable<HttpResponse<Blob>>) | null>(null);
  readonly erreur = input<string | null>(null);
  readonly dupliquer = output<void>();

  protected readonly saisie = SAISIE;
  protected readonly enCours = signal(false);
  protected readonly bloque = computed(() => !this.nom().trim() || this.enCours());

  protected texte(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected async enregistrerJeu(): Promise<void> {
    if (this.bloque()) return;
    this.enCours.set(true);
    try {
      await this.enregistrer()();
    } finally {
      this.enCours.set(false);
    }
  }
}
