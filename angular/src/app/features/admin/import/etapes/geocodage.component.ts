import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import type { GeocodeDetailedResult, GeocodeStatus } from '../../logique/types/import-poi';
import type { ActionGeocodage } from '../data/import-poi.api';
import { ImportPoiService, type FiltreGeocodage } from '../etat/import-poi.service';

/** Au-delà, le tableau devient trop lourd à rendre : on tronque l'affichage (`MAX_ROWS_AFFICHEES`). */
const MAX_LIGNES = 200;

/** Ordre de relecture : les échecs en premier, ce sont eux qui demandent une action (`ORDRE_STATUT`). */
const ORDRE: Record<GeocodeStatus, number> = { red: 0, orange: 1, green: 2 };

/** `statusLabel` de `styles.ts`. */
const LIBELLE: Record<GeocodeStatus, string> = { green: 'OK', orange: 'Approx.', red: 'Echec' };

/** Classe de couleur de texte d'un statut (`statusColor`), lisible dans les deux thèmes. */
const COULEUR: Record<GeocodeStatus, string> = { green: 'vert-t', orange: 'ambre-t', red: 'rouge-t' };

/** Les trois tuiles de compteurs, cliquables pour filtrer (`GeocodeStep.tsx:150-154`). */
const TUILES: { cle: GeocodeStatus; libelle: string; note: string }[] = [
  { cle: 'green', libelle: 'Geocodes OK', note: 'score >= 0.6' },
  { cle: 'orange', libelle: 'Approximatifs', note: 'score 0.3–0.6' },
  { cle: 'red', libelle: 'Non trouves', note: 'score < 0.3' },
];

/**
 * Étape 03c « Geocodage adresses » — portage de `app/admin/import/_components/GeocodeStep.tsx` (lot 6, T13), mode
 * « Geocodage adresse » seulement. Le serveur envoie toutes les adresses du fichier à la BAN
 * (`api-adresse.data.gouv.fr`, service EXTERNE), l'opérateur relit les résultats triés par qualité (échecs en
 * tête), corrige ligne à ligne (nouvelle adresse re-géocodée, coordonnées saisies, ou ligne ignorée), puis
 * VALIDE : sans validation, l'étape 04 reste fermée (`ImportPoiService.etapeAccessible`).
 *
 * Écarts à React, voulus :
 * - tuiles de compteurs : de vrais boutons (React : `div` cliquable, inatteignable au clavier) ;
 * - filtre actif : fond teinté pour les TROIS statuts — React écrivait `${statusColor(f)}22`, soit
 *   `var(--success)22` pour « OK », une valeur CSS invalide ignorée par le navigateur : le filtre vert actif
 *   n'avait pas de fond. Bouton actif signalé par `aria-pressed` ;
 * - champs du formulaire de correction nommés (`aria-label`, React : libellés non reliés) ;
 * - couleurs (C9) : `#f87171`, `#fbbf24`, `rgba(…)` → `--danger`, `--warning`, `color-mix` ; texte vert / ambre /
 *   rouge lisible en clair (`light-dark`) ; `#505050` → `--text-tertiary`.
 *
 * Gardés par parité : textes sans accents (« Geocodage », « Non trouves », « resultats affiches »…), « VALIDE » en
 * capitales, nombres bruts (React n'y formate rien), score à deux décimales, grille `50px 1fr 1fr 60px 70px 120px`,
 * tailles 8 / 9 / 10 / 22 px, 200 lignes au plus.
 */
@Component({
  selector: 'mg-import-geocodage',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './etape-actions.css', './geocodage.component.css'],
  templateUrl: './geocodage.component.html',
})
export class GeocodageComponent {
  protected readonly etat = inject(ImportPoiService);

  protected readonly libelleLancer = computed(() => `Lancer le geocodage (${this.etat.analyse()?.totalRows ?? 0} adresses)`);

  /** `filteredResults`, puis `sortedResults` : échecs, approximatifs, OK (tri stable). */
  private readonly filtres = computed(() => {
    const f = this.etat.filtreGeocodage();
    const rs = this.etat.resultatsGeocodage();
    return f === 'all' ? rs : rs.filter((r) => r.status === f);
  });
  protected readonly nbAffiches = computed(() => this.filtres().length);
  protected readonly lignes = computed(() =>
    [...this.filtres()].sort((a, b) => ORDRE[a.status] - ORDRE[b.status]).slice(0, MAX_LIGNES).map((r) => ({
      r,
      numero: r.rowIndex + 1,
      score: r.score.toFixed(2),
      statut: LIBELLE[r.status],
      couleur: COULEUR[r.status],
      fond: r.status,
    })));
  protected readonly reste = computed(() => Math.max(0, this.filtres().length - MAX_LIGNES));

  /** Barre de filtres (`['all', 'red', 'orange', 'green']`) et ses comptes. */
  protected readonly boutonsFiltre = computed(() => {
    const rs = this.etat.resultatsGeocodage();
    const actif = this.etat.filtreGeocodage();
    return (['all', 'red', 'orange', 'green'] as const).map((f) => ({
      cle: f,
      actif: actif === f,
      texte: f === 'all' ? `Tous (${rs.length})` : `${LIBELLE[f]} (${rs.filter((r) => r.status === f).length})`,
    }));
  });

  protected readonly tuiles = computed(() => {
    const s = this.etat.statsGeocodage();
    const actif = this.etat.filtreGeocodage();
    return TUILES.map((t) => ({ ...t, valeur: s ? s[t.cle] : 0, actif: actif === t.cle }));
  });

  protected readonly avecCoordonnees = computed(() => {
    const s = this.etat.statsGeocodage();
    return s ? s.green + s.orange : 0;
  });

  /** « Valider coords » : deux nombres saisis (`GeocodeStep.tsx:321-322`). */
  protected readonly coordsInvalides = computed(() => {
    const lat = this.etat.latEditee();
    const lng = this.etat.lngEditee();
    return !lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng)) || this.etat.correctionEnCours();
  });
  protected readonly adresseInvalide = computed(() => !this.etat.adresseEditee().trim() || this.etat.correctionEnCours());

  protected filtrer(f: FiltreGeocodage): void {
    this.etat.filtreGeocodage.set(f);
  }

  protected corriger(r: GeocodeDetailedResult, action: ActionGeocodage): void {
    this.etat.corriger(r.rowIndex, action);
  }

  protected regeocoder(r: GeocodeDetailedResult): void {
    this.etat.corriger(r.rowIndex, { type: 'reGeocode', address: this.etat.adresseEditee().trim() });
  }

  protected validerCoords(r: GeocodeDetailedResult): void {
    this.etat.corriger(r.rowIndex, { type: 'manual', lat: Number(this.etat.latEditee()), lng: Number(this.etat.lngEditee()) });
  }

  protected saisir(champ: 'adresse' | 'lat' | 'lng', e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    (champ === 'adresse' ? this.etat.adresseEditee : champ === 'lat' ? this.etat.latEditee : this.etat.lngEditee).set(v);
  }
}
