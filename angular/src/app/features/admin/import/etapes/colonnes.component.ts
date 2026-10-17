import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ImportPoiService } from '../etat/import-poi.service';
import { LIBELLES_SCHEMA } from '../logique/constantes';

/** Une ligne du tableau : la colonne, son rôle (mapping ou libre) et ses deux cases. */
interface LigneColonne {
  nom: string;
  exemples: string;
  mappee: boolean;
  /** Champ de schéma qui la consomme (`colToSchema`), si elle est mappée. */
  schema: string | undefined;
  importee: boolean;
  filtre: boolean;
}

/**
 * Étape 03b « Colonnes a importer » — portage de `app/admin/import/_components/ColumnSelectionStep.tsx`
 * (lot 6, T12). Les colonnes consommées par le mapping standard ou la géolocalisation sont marquées
 * « → schema:<champ> » ; les autres s'importent en metadata, et chacune peut devenir un filtre de carte.
 * Calculs de React à l'identique (`mappedSourceCols`, `colToSchema`, `unmappedCols`, compteurs), en `computed`.
 *
 * Écarts à React, voulus : cases nommées (`aria-label`) ; couleurs (C9) : `rgba(78,205,196,0.04)` → teal à
 * 4 %, `rgba(0,0,0,0.2)` → `--bg-level-0` à 20 % (React : un voile noir aussi en thème clair), `#505050` →
 * `--text-tertiary`, teal en texte lisible en clair. Gardés par parité : textes sans accents (« importees »,
 * « exclu »), « 1 filtres » au pied (React n'accorde que le badge), grille `1fr 180px 80px 70px`.
 */
@Component({
  selector: 'mg-import-colonnes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './colonnes.component.css'],
  templateUrl: './colonnes.component.html',
})
export class ColonnesComponent {
  protected readonly etat = inject(ImportPoiService);

  /** `mappedSourceCols` : toutes les colonnes nommées par le mapping standard ou la géolocalisation. */
  private readonly mappees = computed(() => {
    const geo = this.etat.correspondanceGeo();
    return new Set<string>([
      ...(Object.values(this.etat.correspondance()).filter(Boolean) as string[]),
      geo['colLat'], geo['colLng'], geo['colX'], geo['colY'], geo['colAdresse'], geo['colCodePostal'], geo['colVille'],
    ].filter(Boolean));
  });

  /** `colToSchema` : colonne → libellé du champ ; la géolocalisation passe après le mapping standard. */
  private readonly versSchema = computed(() => {
    const geo = this.etat.correspondanceGeo();
    const r: Record<string, string> = {};
    for (const [champ, col] of Object.entries(this.etat.correspondance())) if (col) r[col] = LIBELLES_SCHEMA[champ] || champ;
    if (geo['colLat']) r[geo['colLat']] = 'latitude';
    if (geo['colLng']) r[geo['colLng']] = 'longitude';
    if (geo['colX']) r[geo['colX']] = 'X Lambert';
    if (geo['colY']) r[geo['colY']] = 'Y Lambert';
    if (geo['colAdresse']) r[geo['colAdresse']] = 'adresse (geoloc)';
    if (geo['colCodePostal']) r[geo['colCodePostal']] = 'CP (geoloc)';
    if (geo['colVille']) r[geo['colVille']] = 'ville (geoloc)';
    return r;
  });

  /** `unmappedCols` : les colonnes libres. */
  private readonly libres = computed(() => this.etat.colonnes().filter((c) => !this.mappees().has(c.name)).map((c) => c.name));

  protected readonly lignes = computed<LigneColonne[]>(() => {
    const importees = this.etat.colonnesImportees();
    const filtres = this.etat.champsFiltres();
    return this.etat.colonnes().map((c) => ({
      nom: c.name,
      exemples: c.sampleValues.slice(0, 2).join(' · '),
      mappee: this.mappees().has(c.name),
      schema: this.versSchema()[c.name],
      importee: importees.includes(c.name),
      filtre: filtres.includes(c.name),
    }));
  });

  /** `importedCount` : les colonnes LIBRES cochées. */
  protected readonly libresImportees = computed(() => {
    const importees = this.etat.colonnesImportees();
    return this.libres().filter((c) => importees.includes(c)).length;
  });
  protected readonly nbLibres = computed(() => this.libres().length);
  protected readonly nbImportees = computed(() => this.libresImportees() + this.mappees().size);
  protected readonly nbFiltres = computed(() => this.etat.champsFiltres().length);

  protected toutImporter(): void {
    this.etat.toutImporter(this.libres());
  }

  protected basculerFiltre(l: LigneColonne): void {
    if (l.importee) this.etat.basculerFiltre(l.nom);
  }
}
