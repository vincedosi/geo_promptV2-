import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { RapportSynchroIris } from '../data/panneaux.types';

/**
 * Bloc « Synchronisation IRIS » du panneau IRIS (`IrisPanel.tsx:300-425`, lot 6, T19) : le bouton
 * « Vérifier » et le rapport de `sync-iris-system` (statut, actions requises, statut des RPC, remplissage
 * par colonne trié). Présentationnel : la requête est faite par le panneau (`verifier`).
 *
 * Couleurs (C9) : `rgba(61,255,160,0.06)` → `--success` à 6 % ; `${C.green}44` / `${C.warn}44` (CSS
 * invalide chez React) → 27 % ; remplissage ≥ 80 % vert, ≥ 30 % avertissement, sinon rouge (React).
 * Gardé par parité : comptes en français (`toLocaleString('fr')` de React, même sortie que `formaterNombre`,
 * la source unique de CLAUDE.md, vague finale D14).
 */
@Component({
  selector: 'mg-iris-synchro',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bloc">
      <div class="tete">
        <div>
          <div class="titre">Synchronisation IRIS</div>
          <div class="sous">Vérifie que les colonnes en base sont alignées avec <span class="accent">IRIS_DB_COLUMNS</span> (db-columns.ts)</div>
        </div>
        <button type="button" class="verifier" data-synchroniser [disabled]="enCours()" (click)="verifier.emit()">
          @if (enCours()) { <mg-icone nom="chargement" [taille]="10" class="tourne" /> Vérification… } @else { Vérifier }
        </button>
      </div>
      @if (erreur(); as e) {
        <div class="erreur" data-erreur-synchro>! {{ e }}</div>
      }
      @if (vue(); as v) {
        <div class="rapport">
          <div class="statut" data-statut-synchro [class.ok]="v.synced">
            <span class="signe">{{ v.synced ? '✓' : '!' }}</span>
            <div>
              <div class="statut-titre">{{ v.synced ? 'Synchronisé' : 'Désynchronisation détectée' }}</div>
              <div class="statut-detail">{{ v.nbBase }} colonnes en base · {{ v.nbCode }} dans IRIS_DB_COLUMNS</div>
            </div>
          </div>
          @if (v.actions.length > 0) {
            <div class="actions">
              <div class="actions-titre">Actions requises</div>
              @for (a of v.actions; track $index) {
                <div class="action" data-action-requise>› {{ a }}</div>
              }
            </div>
          }
          <div class="cadre">
            <div class="cadre-titre">Statut RPCs</div>
            @for (r of v.rpc; track r.nom) {
              <div class="rpc" data-rpc><span class="accent">{{ r.nom }}</span><span class="vert">{{ r.statut }}</span></div>
            }
          </div>
          <div class="cadre">
            <div class="cadre-titre marge">Remplissage par colonne</div>
            <div class="remplissages">
              @for (c of v.remplissage; track c.col) {
                <div class="remplissage" data-remplissage [attr.data-niveau]="c.niveau" [attr.data-hors-code]="!c.dansCode">
                  <div class="gauche">
                    <div class="col">{{ c.col }}</div>
                    <div class="piste"><div class="barre" [style.width.%]="c.largeur"></div></div>
                  </div>
                  <span class="compte">{{ c.compte }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrls: ['./panneaux-commun.css', './iris-synchro.component.css'],
})
export class IrisSynchroComponent {
  readonly rapport = input<RapportSynchroIris | null>(null);
  readonly enCours = input(false);
  readonly erreur = input<string | null>(null);
  readonly verifier = output<void>();

  protected readonly vue = computed(() => {
    const r = this.rapport();
    if (!r) return null;
    const total = r.fill_status['population'] || 1;
    return {
      synced: r.synced,
      nbBase: r.db_columns.length,
      nbCode: r.code_columns.length,
      actions: r.manual_actions_needed,
      rpc: Object.entries(r.rpc_status).map(([nom, statut]) => ({ nom, statut })),
      remplissage: Object.entries(r.fill_status)
        .sort((a, b) => b[1] - a[1])
        .map(([col, n]) => {
          const pct = Math.round((n / total) * 100);
          return {
            col, compte: formaterNombre(n), largeur: Math.min(pct, 100),
            niveau: pct >= 80 ? 'bon' : pct >= 30 ? 'moyen' : 'faible', dansCode: r.code_columns.includes(col),
          };
        }),
    };
  });
}
