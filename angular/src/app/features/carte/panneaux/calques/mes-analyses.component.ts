import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ligneMetaAnalyse } from '../../logique/analyses/commun';
import { MesAnalysesService } from './mes-analyses.service';

/** Le petit bouton d'action d'une ligne (outline neutre, `DESIGN_SYSTEM` § Bouton outline) ; la confirmation, en danger. */
const ACTION_BASE = 'cursor-pointer rounded-[4px] border-fin bg-transparent px-2 py-[2px] text-[10px] disabled:cursor-not-allowed disabled:opacity-40';
const ACTION = `${ACTION_BASE} border-default text-secondary`;
const ACTION_DANGER = `${ACTION_BASE} border-danger text-danger`;

/**
 * Le contenu du groupe « Mes analyses » du panneau Calques — le rendu de `PanneauCalques.tsx:656-710` (lot 4, T18) :
 * chargement, erreur, liste vide, puis une ligne par analyse (nom, date · maillage · statut, badge du type). S'y
 * ajoutent « Rejouer » (un score seulement : c'est le seul type dont le résultat se PEINT sur la carte) et
 * « Supprimer », confirmé sur la ligne même. L'état vit dans `MesAnalysesService`, fourni par le panneau.
 */
@Component({
  selector: 'mg-mes-analyses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (m.chargement()) {
      <div class="px-4 py-6 text-center text-[12px] text-tertiary">Chargement…</div>
    } @else if (m.erreur(); as e) {
      <div data-erreur class="px-4 py-6 text-center text-[12px] text-danger">{{ e }}</div>
    } @else if (m.analyses().length === 0) {
      <div class="px-4 py-6 text-center text-[12px] text-tertiary">Aucune analyse enregistrée</div>
    } @else {
      <div class="flex flex-col">
        @for (a of m.analyses(); track a.id) {
          @let etat = m.lignes()[a.id];
          <div [attr.data-analyse]="a.id" class="flex items-center justify-between gap-2 border-t-fin border-subtle px-[14px] py-[10px]">
            <div class="min-w-0">
              <div data-nom class="truncate text-[13px] text-primary">{{ a.nom }}</div>
              <div data-meta class="mt-0.5 font-mono text-[10px] text-tertiary">{{ meta(a) }}</div>
              <div class="mt-1.5 flex gap-1.5">
                @if (etat?.action === 'confirmation' || etat?.action === 'suppression') {
                  <button type="button" data-confirmer [disabled]="etat?.action === 'suppression'" (click)="m.supprimer(a.id)"
                    [class]="actionDanger">{{ etat?.action === 'suppression' ? 'Suppression…' : 'Confirmer la suppression' }}</button>
                  <button type="button" data-annuler [disabled]="etat?.action === 'suppression'" (click)="m.annulerSuppression(a.id)" [class]="action">Annuler</button>
                } @else {
                  @if (a.type === 'score') {
                    <button type="button" data-rejouer [disabled]="etat?.action === 'rejeu'" (click)="m.rejouer(a.id)"
                      [class]="action">{{ etat?.action === 'rejeu' ? 'Calcul…' : 'Rejouer' }}</button>
                  }
                  <button type="button" data-supprimer [disabled]="etat?.action === 'rejeu'" (click)="m.demanderSuppression(a.id)" [class]="action">Supprimer</button>
                }
              </div>
              @if (etat?.message; as message) {
                <div data-message class="mt-1 text-[11px] text-danger">{{ message }}</div>
              }
            </div>
            <span data-type class="shrink-0 rounded-[4px] border-fin border-default bg-[var(--overlay)] px-2 py-[2px] text-[10px] text-tertiary">{{ a.type }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class MesAnalysesComponent {
  protected readonly m = inject(MesAnalysesService);
  protected readonly meta = ligneMetaAnalyse;
  protected readonly action = ACTION;
  protected readonly actionDanger = ACTION_DANGER;
}
