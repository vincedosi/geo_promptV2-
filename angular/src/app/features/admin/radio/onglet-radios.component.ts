import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { RadioAdminApi, type FiltreStations, type StationRadio } from './data/radio-admin.api';
import { RadioImportService } from './etat/radio-import.service';
import { RadioOngletsService } from './etat/radio-onglets.service';
import { libelleSlug, slugRadio } from './logique/radio';

/** Les trois filtres de React (`page.tsx:619`), dans l'ordre, avec leur teinte quand ils sont actifs. */
const FILTRES: readonly { valeur: FiltreStations; libelle: string; teinte: 'teal' | 'succes' | 'danger' }[] = [
  { valeur: 'all', libelle: 'Toutes', teinte: 'teal' },
  { valeur: 'matched', libelle: 'Avec émetteurs', teinte: 'succes' },
  { valeur: 'unmatched', libelle: 'Sans émetteurs', teinte: 'danger' },
];

/** Taille de page de React (`limit: '20'`, `page.tsx:144`). */
const PAR_PAGE = 20;

/**
 * Onglet « Radios » de l'écran Radio (`admin/donnees/importer/radio/radios`) — portage de
 * `app/admin/radio/page.tsx:598-718` et de `fetchRadios` (l.141-160) (lot 6, T17). Lecture seule.
 *
 * Comme React : UN `GET /api/radio/stations` à l'ouverture, puis un à chaque frappe dans la recherche
 * (pas de validation, pas d'anti-rebond), à chaque filtre et à chaque page ; la recherche et le filtre
 * ramènent en page 1 ; l'onglet RELIT à chaque retour (l.336) ; recherche, filtre et page vivent au
 * niveau de la page (`RadioOngletsService`).
 *
 * Écarts à React, voulus et listés au rapport :
 * - **lecture précédente annulée** quand une nouvelle part : React laissait les réponses arriver dans le
 *   désordre (une frappe rapide pouvait afficher les résultats d'une recherche plus ancienne) ;
 * - **refus de la route affiché** (`role="alert"`) : React gardait l'état précédent, donc « Aucune radio
 *   en base » et un bouton d'import au premier refus ;
 * - **compteur** `radios_matchees / total_radios` : React écrivait `emetteurs_matches / total_radios`
 *   (« 11836/1175 radios matchées (1007%) ») ;
 * - **couleurs** (C9) : `rgba(…)` des filtres et pastilles → `color-mix` des jetons ; teal du texte lisible
 *   en clair (`light-dark`, comme T16) ;
 * - **« Lancer un import »** : lien RELATIF vers l'onglet Import (React : `setTab('import')`).
 */
@Component({
  selector: 'mg-radio-radios',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onglet-radios.component.html',
  styleUrl: './onglet-radios.component.css',
})
export class OngletRadiosComponent {
  private readonly api = inject(RadioAdminApi);
  private readonly stats = inject(RadioImportService).stats;
  protected readonly reglages = inject(RadioOngletsService);

  protected readonly filtres = FILTRES;
  protected readonly colonnes = ['Nom', 'Cat.', 'Émetteurs', 'Freq FM', 'Réseau', 'Slug', ''] as const;

  protected readonly chargement = signal(false);
  protected readonly erreur = signal<string | null>(null);
  private readonly radios = signal<StationRadio[]>([]);
  protected readonly total = signal(0);

  protected readonly lignes = computed(() => this.radios().map((r) => {
    const slug = slugRadio(r.nom);
    const emetteurs = r.nb_emetteurs ?? 0;
    return {
      id: r.id,
      nom: r.nom,
      categorie: r.categorie_arcom ?? '—',
      emetteurs,
      freq: r.nb_freq_fm ?? '—',
      reseau: r.parent_nom ?? null,
      slug: libelleSlug(slug),
      url: `https://www.frequence-radio.com/frequence-${slug}.html`,
      page: `frequence-${slug}.html`,
    };
  }));

  /** `stats && …` (`page.tsx:631-635`) — sur les RADIOS matchées (voir l'en-tête). */
  protected readonly compteur = computed(() => {
    const s = this.stats();
    if (!s) return null;
    const matchees = s.radios_matchees ?? s.emetteurs_matches;
    const pct = s.total_radios > 0 ? Math.round(matchees / s.total_radios * 100) : 0;
    return `${matchees}/${s.total_radios} radios matchées (${pct}%)`;
  });

  protected readonly pagination = computed(() => this.total() > PAR_PAGE);
  protected readonly precedentCoupe = computed(() => this.reglages.page() <= 1);
  protected readonly suivantCoupe = computed(() => this.reglages.page() * PAR_PAGE >= this.total());

  private lecture: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.lire();
  }

  protected chercher(valeur: string): void {
    this.reglages.recherche.set(valeur);
    this.reglages.page.set(1);
    this.lire();
  }

  protected filtrer(valeur: FiltreStations): void {
    this.reglages.filtre.set(valeur);
    this.reglages.page.set(1);
    this.lire();
  }

  protected allerA(decalage: 1 | -1): void {
    this.reglages.page.update((p) => p + decalage);
    this.lire();
  }

  /** `fetchRadios` : la lecture en cours est annulée (seule la dernière demande compte). */
  private lire(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.lecture = this.api.stations({
      page: this.reglages.page(), filtre: this.reglages.filtre(), recherche: this.reglages.recherche(),
    }).subscribe({
      next: (d) => {
        this.radios.set(d.stations ?? []);
        this.total.set(d.total ?? 0);
        this.erreur.set(null);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageErreurApi(e));
        this.chargement.set(false);
      },
    });
  }
}
