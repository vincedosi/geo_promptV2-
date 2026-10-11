import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formaterNombre } from '../../../../../../core/format/nombre';
import { DUREE_MAX, DUREE_MIN, RACCOURCIS_DUREE, TRANSPORTS, dureeEnCours, dureeSaisie } from '../../../../logique/clustering/assistant';
import { ChoixVariablesComponent } from './choix-variables.component';
import { EtatAssistantClusteringService } from './etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './styles-assistant';

/**
 * Étape 3 de l'assistant — « Paramètres de calcul » (`ClusteringWizard.tsx:435-679`) : le nombre de POI du périmètre,
 * les variables, la durée d'isochrone, le mode de transport, le dry-run, et le refus du lancement s'il y en a un.
 *
 * `erreur` vient du parent : le refus de la GARDE (panneau Analyse) ou celui du SERVEUR (503 « script absent »…), tel
 * quel, précédé de « ! » comme React.
 */
@Component({
  selector: 'mg-etape-parametres',
  imports: [ChoixVariablesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[14px]' },
  template: `
    <div class="intertitre">3 / 4 — Paramètres de calcul</div>

    <div data-comptage class="tuile flex items-center gap-2 px-3 py-[10px]">
      @if (etat.chargementComptage()) {
        <span class="mono text-[11px] text-tertiary">Comptage…</span>
      } @else if (comptage(); as n) {
        <span class="inter text-[18px] text-success">{{ n }}</span>
        <span class="mono text-[10px] text-secondary">POIs dans le périmètre</span>
      } @else {
        <span class="mono text-[11px] text-danger">Erreur comptage</span>
      }
    </div>

    <mg-choix-variables />

    <div>
      <div class="intertitre mb-1.5 text-[9px]!">Durée isochrone (minutes)</div>
      <div class="flex items-center gap-2">
        <input type="number" data-duree [min]="min" [max]="max" [value]="etat.duree()" aria-label="Durée isochrone (minutes)"
               (input)="saisir($any($event.target).value)" (change)="valider($any($event.target))"
               class="champ mono w-20 rounded-[2px] bg-elevated px-[10px] py-[7px] text-[13px] text-primary outline-none" />
        <span class="mono text-[10px] text-secondary">min (5 – 120)</span>
        @for (d of raccourcis; track d) {
          <button type="button" [attr.data-raccourci]="d" [attr.aria-pressed]="etat.duree() === d" (click)="etat.duree.set(d)"
                  class="pastille-bouton mono px-2 py-1 text-[10px]" [class.actif]="etat.duree() === d">{{ d }}</button>
        }
      </div>
    </div>

    <div>
      <div class="intertitre mb-1.5 text-[9px]!">Mode de transport</div>
      <div class="flex gap-1.5">
        @for (t of transports; track t.id) {
          <button type="button" [attr.data-transport]="t.id" [attr.aria-pressed]="etat.transport() === t.id" (click)="etat.transport.set(t.id)"
                  class="choix pastille-bouton inter flex-1 justify-center! py-[7px] text-[9px] tracking-[1px]" [class.actif]="etat.transport() === t.id">{{ t.libelle }}</button>
        }
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button type="button" role="switch" data-dry-run [attr.aria-checked]="etat.dryRun()" aria-label="Dry-run (simuler sans écrire en base)"
              class="interrupteur h-4 w-[30px]" [style.background]="etat.dryRun() ? 'var(--warning)' : null" (click)="etat.dryRun.set(!etat.dryRun())">
        <span class="top-px size-[14px]" [style.left.px]="etat.dryRun() ? 15 : 1"></span>
      </button>
      <span class="mono text-[10px]" [class.text-warning]="etat.dryRun()" [class.text-secondary]="!etat.dryRun()">Dry-run (simuler sans écrire en base)</span>
    </div>

    @if (erreur(); as e) { <div data-erreur-lancement role="alert" class="encart erreur mono px-[11px] py-2">! {{ e }}</div> }
  `,
  styles: [STYLES_ASSISTANT, `
    .champ { border: 0.5px solid var(--border-default); transition: border-color 200ms var(--ease-out); }
    .champ:focus { border-color: var(--brand-teal-50); }
  `],
})
export class EtapeParametresComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);
  /** Le refus du lancement (garde ou serveur), `null` s'il n'y en a pas. */
  readonly erreur = input<string | null>(null);

  protected readonly min = DUREE_MIN;
  protected readonly max = DUREE_MAX;
  protected readonly raccourcis = RACCOURCIS_DUREE;
  protected readonly transports = TRANSPORTS;
  /** Le nombre formaté ; `null` après un échec du comptage (un 0 reste affiché : c'est une réponse). */
  protected readonly comptage = computed(() => {
    const n = this.etat.comptage();
    return n === null ? null : formaterNombre(n);
  });

  /**
   * Une frappe : la durée n'est retenue que si elle est DÉJÀ dans [5, 120]. Borner ici réécrirait le champ par la liaison
   * `[value]` — taper « 120 » passerait par « 5 » au premier chiffre (le défaut React, `onChange` qui bornait).
   */
  protected saisir(texte: string): void {
    const v = dureeEnCours(texte);
    if (v !== null) this.etat.duree.set(v);
  }

  /** La saisie validée (sortie du champ, Entrée) : bornée à [5, 120], et le champ affiche la durée RETENUE. */
  protected valider(champ: HTMLInputElement): void {
    const v = dureeSaisie(champ.value);
    if (v !== null) this.etat.duree.set(v);
    champ.value = String(this.etat.duree());
  }
}
