import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { type FormeLue, lireForme } from '../../logique/zones/import-forme';
import type { Recette } from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

/**
 * Taille au-delà de laquelle un fichier est refusé AVANT toute lecture : `JSON.parse` ou `DOMParser` sur 100 Mo figent
 * l'onglet (revue T9). 5 Mo couvrent largement 20 000 sommets (`MAX_SOMMETS_FORME`), le plafond de la forme.
 */
export const TAILLE_MAX_IMPORT_OCTETS = 5 * 1024 * 1024;
export const MESSAGE_FICHIER_TROP_VOLUMINEUX = 'Fichier trop volumineux (5 Mo au plus).';

const pluriel = (n: number, mot: string) => `${formaterNombre(n)} ${mot}${n > 1 ? 's' : ''}`;

/**
 * « Importer un GeoJSON ou un KML » (lot 3, spec § 16.3) : le fichier est lu DANS le navigateur (`lireForme` : on
 * garde les polygones, on compte ce qu'on ignore, 20 000 sommets au plus), puis sa forme part avec la recette
 * `import` — une forme FIGÉE, que le serveur répare (`ST_MakeValid`) et découpe sur la France. Le formulaire ne
 * compose que sa recette, sa géométrie et sa garde (P4) ; « Aperçu » est au pied.
 */
@Component({
  selector: 'mg-recette-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-3.5 py-3' },
  template: `
    <h5 class="titre-recette">Importer un GeoJSON ou un KML</h5>
    <input #entree type="file" accept=".geojson,.json,.kml" class="hidden" (change)="deposer($event)" />
    <button type="button" data-choisir class="neutre" (click)="entree.click()">{{ nomFichier() ?? 'Choisir un fichier' }}</button>
    @if (lu(); as l) {
      @if (l.ok) {
        <p data-resume class="m-0 font-mono text-[11px] text-secondary">{{ resume() }}</p>
      } @else {
        <p data-refus role="alert" class="erreur m-0">{{ l.message }}</p>
      }
    } @else {
      <p data-garde class="garde">{{ lecture() ? 'Lecture du fichier…' : 'Polygones seulement ; points et lignes sont ignorés. 5 Mo au plus.' }}</p>
    }
  `,
  styles: [STYLES_RECETTE],
})
export class RecetteImportComponent {
  protected readonly nomFichier = signal<string | null>(null);
  protected readonly lecture = signal(false);
  protected readonly lu = signal<FormeLue | null>(null);
  private detruit = false;
  /** Numéro du dernier dépôt. */
  private depots = 0;

  protected readonly resume = computed(() => {
    const l = this.lu();
    if (!l?.ok) return '';
    return pluriel(l.polygones, 'polygone') + (l.ignores > 0 ? ` · ${pluriel(l.ignores, 'élément')} ignoré${l.ignores > 1 ? 's' : ''}` : '');
  });
  readonly garde = computed(() => {
    const l = this.lu();
    if (!l) return 'Choisissez un fichier GeoJSON ou KML.';
    return l.ok ? null : l.message;
  });
  readonly recette = computed<Recette | null>(() => {
    const l = this.lu();
    const nom = this.nomFichier();
    return l?.ok && nom ? { v: 1, type: 'import', format: l.format, fichier: nom.slice(0, 200) } : null;
  });
  readonly geometrie = computed<GeoJSON.Geometry | undefined>(() => {
    const l = this.lu();
    return l?.ok ? l.geometrie : undefined;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.detruit = true));
  }

  /**
   * Deux dépôts rapprochés peuvent se lire dans le désordre (un gros fichier puis un petit) : seule la lecture du
   * DERNIER dépôt est gardée (numéro de dépôt), la plus ancienne arrivée après lui est jetée.
   */
  protected async deposer(e: Event): Promise<void> {
    const champ = e.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    if (!fichier) return;
    const depot = ++this.depots;
    this.nomFichier.set(fichier.name);
    if (fichier.size > TAILLE_MAX_IMPORT_OCTETS) {
      this.lu.set({ ok: false, message: MESSAGE_FICHIER_TROP_VOLUMINEUX });
      this.lecture.set(false);
      champ.value = '';
      return;
    }
    this.lu.set(null);
    this.lecture.set(true);
    let lu: FormeLue;
    try {
      lu = lireForme(await fichier.text(), fichier.name);
    } catch {
      lu = { ok: false, message: 'Fichier illisible.' };
    }
    if (this.detruit || depot !== this.depots) return;
    this.lu.set(lu);
    this.lecture.set(false);
    // Le même fichier, redéposé après correction, doit redéclencher `change`.
    champ.value = '';
  }
}
