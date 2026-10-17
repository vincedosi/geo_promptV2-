import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { ImportPoiService } from '../etat/import-poi.service';

/**
 * Étape 04 « Test (dry-run) » — portage de `app/admin/import/_components/DryRunStep.tsx` (lot 6, T13) : les 100
 * premières lignes passées au validateur de la route (rien en base), compteurs valides / sans coordonnées /
 * exclus, compteurs de géocodage quand il y en a, échantillon des points obtenus et détail des erreurs.
 *
 * Écarts à React, voulus : couleurs (C9) — `#f87171`, `#fbbf24` → `--danger`, `--warning`, texte vert / ambre /
 * rouge et teal lisible en clair (`light-dark`) ; « Total fichier » par `formaterNombre` (React :
 * `toLocaleString()` de la langue du navigateur, `fr-FR` ici).
 * Gardés par parité : textes sans accents (« Points d'apercu », « Echecs geocodage »), « > Tester (100 lignes) »,
 * échantillon en JSON indenté, tailles 8 / 9 / 10 / 22 px, bords 1 px et rayon 2. Pas d'aperçu cartographique :
 * React l'a retiré le 2026-09-07 (le CSP bloquait l'`iframe`).
 */
@Component({
  selector: 'mg-import-essai',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './etape-actions.css'],
  styles: [`
    .essayer { min-width: 200px; }
    .essayer:disabled { opacity: 0.6; }
    .resultat { margin-top: 16px; }
    .tuiles.seconde { margin-top: 10px; }
    details { margin-top: 8px; }
    summary { font-family: var(--font-sans); font-size: 9px; font-weight: 500; color: var(--text-secondary); cursor: pointer; }
    details.erreurs summary { color: var(--ambre-texte); }
    pre {
      background: var(--bg-level-2); border: 1px solid var(--border-subtle); border-radius: 2px; padding: 10px;
      font-family: var(--font-mono); font-size: 10px; max-height: 150px; overflow: auto; margin: 6px 0 0; color: var(--text-secondary);
    }
    details.erreurs pre { color: var(--ambre-texte); }
    .marge-12 { margin-top: 12px; }
  `],
  template: `
    <div class="carte">
      <div class="entete">
        <span class="num" data-num>04</span>
        <span class="titre" data-titre>Test (dry-run)</span>
        @if (reussi(); as r) {
          <span class="badge vert a-droite" data-valides>{{ r.stats.validRows }} valides</span>
        }
      </div>
      <div class="corps">
        <button type="button" class="bouton succes essayer" data-essayer [disabled]="etat.essaiEnCours()" (click)="etat.essayer()">
          @if (etat.essaiEnCours()) {
            <mg-icone nom="chargement" [taille]="12" class="tourne" /> Test en cours...
          } @else {
            &gt; Tester (100 lignes)
          }
        </button>

        @if (reussi(); as r) {
          <div class="resultat">
            <div class="tuiles" data-tuiles>
              <div class="tuile"><div class="tuile-libelle">Valides</div><div class="tuile-valeur vert-t">{{ r.stats.validRows }}</div></div>
              <div class="tuile"><div class="tuile-libelle">Sans coords</div><div class="tuile-valeur ambre-t">{{ r.stats.missingCoords }}</div></div>
              <div class="tuile"><div class="tuile-libelle">Exclus</div><div class="tuile-valeur rouge-t">{{ r.stats.invalidRows }}</div></div>
            </div>

            @if (r.stats.geocodedRows !== undefined) {
              <div class="tuiles seconde" data-tuiles-geocodage>
                <div class="tuile"><div class="tuile-libelle">Geocodes</div><div class="tuile-valeur teal-t">{{ r.stats.geocodedRows }}</div></div>
                <div class="tuile"><div class="tuile-libelle">Echecs geocodage</div><div class="tuile-valeur rouge-t">{{ r.stats.geocodeErrors }}</div></div>
                <div class="tuile"><div class="tuile-libelle">Total fichier</div><div class="tuile-valeur secondaire-t">{{ totalFichier() }}</div></div>
              </div>
            }

            @if (r.samplePoints.length > 0) {
              <details data-echantillon>
                <summary>Points d'apercu ({{ r.samplePoints.length }})</summary>
                <pre>{{ echantillon() }}</pre>
              </details>
            }

            @if (r.errors.length > 0) {
              <details class="erreurs" data-erreurs>
                <summary>Erreurs ({{ r.errors.length }})</summary>
                <pre>{{ erreurs() }}</pre>
              </details>
            }
          </div>
        }

        @if (echec(); as message) {
          <div class="alerte rouge marge-12" data-erreur>! {{ message }}</div>
        }
      </div>
    </div>
  `,
})
export class EssaiComponent {
  protected readonly etat = inject(ImportPoiService);

  protected readonly reussi = computed(() => {
    const e = this.etat.essai();
    return e?.success ? e : null;
  });
  /** `dryRunResult && !dryRunResult.success` : le message de la route (`undefined` rendu vide, comme React). */
  protected readonly echec = computed(() => {
    const e = this.etat.essai();
    return e && !e.success ? `${e.error ?? ''}` || ' ' : null;
  });
  protected readonly totalFichier = computed(() => formaterNombre(this.reussi()?.stats.totalRows ?? 0));
  protected readonly echantillon = computed(() => JSON.stringify(this.reussi()?.samplePoints ?? [], null, 2));
  protected readonly erreurs = computed(() =>
    (this.reussi()?.errors ?? []).map((e) => `Ligne ${e.row}: [${e.field}] ${e.message}`).join('\n'));
}
