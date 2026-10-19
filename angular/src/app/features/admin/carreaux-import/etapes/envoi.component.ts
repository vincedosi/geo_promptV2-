import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { JournalComponent } from '../../commun/journal.component';
import { ProgressionImportComponent } from '../../commun/progression-import.component';
import { fmtTime } from '../../logique/formats';
import { ImportShapefileService } from '../etat/import-shapefile.service';
import { EXCLUE } from '../logique/lots';

/**
 * Étape 3 de l'import Shapefile — portage de `app/admin/carreaux-import/_components/ImportStep.tsx` (lot 6, T14) :
 * récapitulatif (features, colonnes, résolution, millésime), « Lancer l'insertion (N features) », progression
 * avec débit, ETA et durée, terminal de logs horodatés, puis « Retour au mapping » / « Nouvel import ».
 *
 * Progression (C5) : `mg-progression-import`, étapes NOMMÉES « Envoi » (lots envoyés / total, DÉTERMINÉE : le
 * total est connu d'avance) puis « Enregistrement » (indéterminée, une requête) ; affichée DÈS le lancement
 * (React : seulement après le premier lot rendu) ; échec = `! N lot(s) en erreur — …` comme React.
 *
 * Pendant l'envoi, une ligne dit ce que coûte un départ (vague finale, I-2) : quitter « Importer » demande
 * confirmation, mais une fermeture d'onglet ou une navigation de l'hôte ne le peut pas.
 *
 * Écarts à React, voulus : barre unie sans dégradé ni halo (flat total) ; terminal `mg-journal` (C14) sur
 * `--bg-level-0` (React : `#020202` dans les deux thèmes) ; pastilles du terminal et « Nouvel import » en jetons
 * (`--danger`, `--warning`, `--success`, `--info` ; React : hex en dur) ; bleu des lignes « RAPPORT » → `--info`.
 * Indentation des lignes du rapport (« ␣␣Lignes insérées… ») AFFICHÉE : les espaces sont dans les textes de React,
 * mais son `<div>` en blancs normaux les fondait ; `mg-journal` est en `pre-wrap` (vague finale, B6 : écart listé).
 * Gardés : textes, tailles, grille de 4, `fmtTime`, `N lignes` du terminal.
 */
@Component({
  selector: 'mg-shapefile-envoi',
  imports: [JournalComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './etape-shapefile.css',
  template: `
    <div class="pile">
      <div class="carte recap">
        @for (c of recap(); track c.libelle) {
          <div>
            <p class="libelle">{{ c.libelle }}</p>
            <p class="mono valeur" [class.accent]="c.accent" [attr.data-recap]="c.libelle">{{ c.valeur }}</p>
          </div>
        }
      </div>

      @if (!etat.importEnCours() && !etat.termine()) {
        <button type="button" class="principal lancer" (click)="etat.importer()">Lancer l'insertion ({{ nombre() }} features)</button>
      }

      @if (barre(); as b) {
        <mg-progression-import
          data-envoi
          [etape]="b.etape"
          [traitees]="b.traitees"
          [total]="b.total"
          [termine]="b.termine"
          [echec]="b.echec"
        >
          <ng-container mesures>
            @if (mesures().debit) { <span data-debit>{{ mesures().debit }}</span> }
            @if (mesures().eta) { <span data-eta>{{ mesures().eta }}</span> }
            <span class="duree" data-duree>{{ mesures().duree }}</span>
          </ng-container>
        </mg-progression-import>
      }

      @if (etat.importEnCours()) {
        <p class="avertissement" role="note" data-avertissement-envoi>Restez dans « Importer » jusqu’à la fin : si l’envoi s’arrête, les lots déjà envoyés resteront en base sans source enregistrée.</p>
      }

      <div class="terminal">
        <div class="barre-terminal">
          <div class="pastilles" aria-hidden="true">
            <span class="p rouge"></span><span class="p ambre"></span><span class="p vert"></span>
          </div>
          <span class="titre-terminal">Import logs</span>
          <span class="mono nb" data-nb-lignes>{{ etat.journal().length }} lignes</span>
        </div>
        @if (etat.journal().length === 0) {
          <p class="mono attente">En attente du lancement…</p>
        } @else {
          <mg-journal [lignes]="etat.journal()" [hauteur]="300" />
        }
      </div>

      <div class="boutons">
        <button type="button" class="secondaire" [disabled]="etat.importEnCours()" (click)="etat.choisirEtape(2)">Retour au mapping</button>
        @if (etat.termine()) {
          <button type="button" class="nouvel" (click)="etat.reinitialiser()">Nouvel import</button>
        }
      </div>
    </div>
  `,
  styles: `
    .recap { padding: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    .libelle { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .valeur { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 4px; }
    .valeur.accent { color: var(--success-texte); }
    .lancer { width: 100%; padding: 16px 0; font-size: 13px; }
    .duree { font-weight: 700; color: var(--text-primary); }
    .avertissement { font-family: var(--font-sans); font-size: 12px; color: var(--text-secondary); margin: 0; }
    .terminal { border: 1px solid var(--border-subtle); border-radius: 2px; overflow: hidden; background: var(--bg-level-0); }
    .barre-terminal {
      padding: 8px 14px; background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle);
      display: flex; align-items: center; gap: 8px;
    }
    .pastilles { display: flex; gap: 5px; }
    .p { width: 10px; height: 10px; border-radius: 50%; }
    .p.rouge { background: var(--danger); }
    .p.ambre { background: var(--warning); }
    .p.vert { background: var(--success); }
    .titre-terminal { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-tertiary); margin-left: 6px; }
    .nb { font-size: 10px; color: var(--text-tertiary); margin-left: auto; }
    .attente { height: 300px; box-sizing: border-box; padding: 14px 16px; font-size: 11px; line-height: 1.7; color: var(--text-tertiary); }
    .boutons { display: flex; gap: 10px; }
    .nouvel {
      padding: 10px 20px; border-radius: 2px; font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer;
      background: color-mix(in srgb, var(--info) 10%, transparent); border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
      color: var(--info-texte); transition: background 0.15s;
    }
    .nouvel:hover { background: color-mix(in srgb, var(--info) 18%, transparent); }
  `,
})
export class EnvoiComponent {
  protected readonly etat = inject(ImportShapefileService);

  protected readonly nombre = computed(() => formaterNombre(this.etat.features().length));

  protected readonly recap = computed(() => [
    { libelle: 'Features', valeur: this.nombre(), accent: false },
    { libelle: 'Colonnes', valeur: String(this.etat.mappings().filter((m) => m.target !== EXCLUE).length), accent: false },
    { libelle: 'Résolution', valeur: this.etat.resolution(), accent: true },
    { libelle: 'Millésime', valeur: this.etat.millesime(), accent: true },
  ]);

  /** La carte de progression, dès le lancement (`progression` posée à 0 / total). */
  protected readonly barre = computed(() => {
    const p = this.etat.progression();
    if (!p || (!this.etat.importEnCours() && !this.etat.termine())) return null;
    const termine = this.etat.termine();
    const enregistrement = this.etat.phase() === 'Enregistrement' && !termine;
    return {
      etape: this.etat.phase(),
      traitees: enregistrement ? null : p.current,
      total: enregistrement ? null : p.total,
      termine,
      echec: termine ? this.etat.erreurImport() || null : null,
    };
  });

  /** Débit, ETA et durée de React (l.58-60, 152-158). */
  protected readonly mesures = computed(() => {
    const p = this.etat.progression();
    const ecoule = this.etat.ecoule();
    const debit = p && ecoule > 0 ? Math.round(p.current / ecoule) : 0;
    const eta = p && debit > 0 ? Math.ceil((p.total - p.current) / debit) : 0;
    return {
      debit: debit > 0 ? `${formaterNombre(debit)}/s` : '',
      eta: this.etat.importEnCours() && eta > 0 ? `ETA ~${fmtTime(eta)}` : '',
      duree: fmtTime(ecoule),
    };
  });
}
