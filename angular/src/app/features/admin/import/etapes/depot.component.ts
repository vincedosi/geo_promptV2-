import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { DepotFichiersComponent } from '../../commun/depot-fichiers.component';
import { ImportPoiService } from '../etat/import-poi.service';
import { FORMATS_ACCEPTES } from '../logique/constantes';

/**
 * Étape 01 « Upload fichier » — portage de `app/admin/import/_components/UploadStep.tsx` (lot 6, T12).
 * La zone est `mg-depot-fichiers` (multiple, `28px 20px`, fond transparent, teal au survol d'un glisser) ;
 * le résultat de `/api/admin/import-poi/parse` vient de `ImportPoiService.analyse`.
 *
 * Écarts à React, voulus : nombres en `fr-FR` (`formaterNombre`, React : `toLocaleString()` sans langue) ;
 * zone focalisable et ouverte au clavier (`mg-depot-fichiers`) ; couleurs (C9) : `#f87171` → `--danger`,
 * `rgba(…)` → `color-mix` des jetons, `#505050` → `--text-tertiary`, teal en texte lisible en clair.
 * Gardés par parité : textes sans accents (« selectionner », « premieres »…), « MB » de `toFixed(2)`,
 * l'aperçu replié (`<details>`), 8 colonnes au plus puis « ... ».
 */
@Component({
  selector: 'mg-import-depot',
  imports: [DepotFichiersComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './depot.component.html',
  styleUrls: ['./etape.css', './depot.component.css'],
})
export class DepotComponent {
  protected readonly etat = inject(ImportPoiService);
  protected readonly accepter = FORMATS_ACCEPTES;

  protected readonly fichier = computed(() => this.etat.fichiers()[0] ?? null);
  /** L'analyse, seulement si elle a réussi (`parseResult?.success`). */
  protected readonly reussie = computed(() => {
    const a = this.etat.analyse();
    return a?.success ? a : null;
  });
  protected readonly erreur = computed(() => {
    const a = this.etat.analyse();
    return a && !a.success ? a.error : null;
  });
  protected readonly lignes = computed(() => formaterNombre(this.reussie()?.totalRows));
  protected readonly taille = computed(() => ((this.fichier()?.size ?? 0) / 1024 / 1024).toFixed(2));
  protected readonly separateur = computed(() => {
    const s = this.reussie()?.separator;
    return s === '\t' ? 'TAB' : `"${s}"`;
  });
  /** L'aperçu ne montre que les 8 premières colonnes (`columns.slice(0, 8)`). */
  protected readonly colonnesApercu = computed(() => (this.reussie()?.columns ?? []).slice(0, 8));
  protected readonly colonnesEnPlus = computed(() => (this.reussie()?.columns.length ?? 0) > 8);
}
