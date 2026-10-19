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

/** Anti-rebond de la recherche (vague finale C1, écart à React) : chaque frappe coûtait une lecture lourde. */
export const ANTI_REBOND_RECHERCHE_MS = 300;

/**
 * Onglet « Radios » de l'écran Radio (`admin/donnees/importer/radio/radios`) — portage de
 * `app/admin/radio/page.tsx:598-718` et de `fetchRadios` (l.141-160) (lot 6, T17). Lecture seule.
 *
 * Comme React : UN `GET /api/radio/stations` à l'ouverture, puis un à chaque filtre et à chaque page ; la
 * recherche et le filtre ramènent en page 1 ; recherche, filtre et page vivent au niveau de la page
 * (`RadioOngletsService`).
 *
 * Écarts à React, voulus et listés au rapport :
 * - **anti-rebond de 300 ms sur la recherche** (vague finale C1) : React lisait à CHAQUE frappe, chaque lecture
 *   coûtant ≈ 407 000 buffers (`count_emetteurs_par_radio`) ; un filtre ou une page partent tout de suite et
 *   annulent la minuterie ;
 * - **pas de relecture au simple retour sur l'onglet** (I-3 / Q-3) : le dernier résultat est gardé dans
 *   `RadioOngletsService` avec ses réglages ; « Rafraîchir » (bouton ajouté) relit, un import terminé ou une
 *   suppression invalident ;
 * - **compteur masqué** quand `radios_matchees` manque (C4), plutôt que de retomber sur le faux pourcentage ;
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
  styleUrls: ['./onglet-radios.component.css', './onglet-radios-tableau.css'],
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

  /** `stats && …` (`page.tsx:631-635`) — sur les RADIOS matchées (voir l'en-tête) ; rien si la RPC ne les rend pas. */
  protected readonly compteur = computed(() => {
    const s = this.stats();
    if (!s || s.radios_matchees === undefined || s.radios_matchees === null) return null;
    const matchees = s.radios_matchees;
    const pct = s.total_radios > 0 ? Math.round(matchees / s.total_radios * 100) : 0;
    return `${matchees}/${s.total_radios} radios matchées (${pct}%)`;
  });

  protected readonly pagination = computed(() => this.total() > PAR_PAGE);
  protected readonly precedentCoupe = computed(() => this.reglages.page() <= 1);
  protected readonly suivantCoupe = computed(() => this.reglages.page() * PAR_PAGE >= this.total());

  private lecture: Subscription | null = null;
  private rebond: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.annulerRebond();
    });
    const gardees = this.reglages.stations();
    if (gardees && gardees.cle === this.reglages.cleStations()) {
      this.radios.set(gardees.stations);
      this.total.set(gardees.total);
    } else {
      this.lire();
    }
  }

  /** La saisie s'affiche tout de suite ; la lecture part 300 ms après la DERNIÈRE frappe (C1). */
  protected chercher(valeur: string): void {
    this.reglages.recherche.set(valeur);
    this.reglages.page.set(1);
    this.annulerRebond();
    this.rebond = setTimeout(() => {
      this.rebond = null;
      this.lire();
    }, ANTI_REBOND_RECHERCHE_MS);
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

  /** « Rafraîchir » (écart à React, Q-3) : relit la page courante. */
  protected rafraichir(): void {
    this.lire();
  }

  private annulerRebond(): void {
    if (this.rebond !== null) clearTimeout(this.rebond);
    this.rebond = null;
  }

  /**
   * `fetchRadios` : la lecture en cours est annulée (seule la dernière demande compte), comme une recherche en
   * attente d'anti-rebond. Le résultat est gardé avec ses réglages (`RadioOngletsService.stations`).
   */
  private lire(): void {
    this.annulerRebond();
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    const cle = this.reglages.cleStations();
    this.lecture = this.api.stations({
      page: this.reglages.page(), filtre: this.reglages.filtre(), recherche: this.reglages.recherche(),
    }).subscribe({
      next: (d) => {
        const stations = d.stations ?? [];
        const total = d.total ?? 0;
        this.radios.set(stations);
        this.total.set(total);
        this.reglages.stations.set({ cle, stations, total });
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
