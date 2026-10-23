import { DestroyRef, Injectable, type Signal, type WritableSignal, inject, linkedSignal, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CarteApi, type CategoriePoi, type OrigineCategorie } from '../data/carte.api';

/** Un type de POI proposé dans la section. */
export interface TypePoi {
  readonly id: string;
  readonly label: string;
  readonly origine: OrigineCategorie;
}

/**
 * Le type de POI retenu d'une liste : le premier dès que la liste arrive, gardé tant qu'il y figure — ③ « rayon autour
 * d'un type de POI » et ④ « couverture par rayon ».
 */
export function typePoiRetenu(types: Signal<readonly { id: string }[]>): WritableSignal<string> {
  return linkedSignal<readonly { id: string }[], string>({
    source: types,
    computation: (liste, avant) => (avant && liste.some((t) => t.id === avant.value) ? avant.value : liste[0]?.id ?? ''),
  });
}

/** Délai de la reprise unique (`use-poi-catalog.ts:87-90`). */
export const DELAI_REPRISE_CATEGORIES_MS = 800;

/**
 * Une chaîne brute devient `{ id, label }` : initiale en capitale, `_` en espaces (`use-poi-catalog.ts:76-80`).
 * `origine` est TOUJOURS posée : « espace » seulement si la route le dit ; une chaîne, un objet sans le champ ou une
 * valeur inconnue sont « commune » — on ne présente jamais comme donnée de l'espace ce que la route n'a pas qualifié.
 */
export function typeDePoi(c: CategoriePoi): TypePoi {
  if (typeof c === 'string') return { id: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' '), origine: 'commune' };
  return { id: c.id, label: c.label, origine: c.origine === 'espace' ? 'espace' : 'commune' };
}

/**
 * Le catalogue des types de POI — `usePoiCatalog` (`filter-panel/use-poi-catalog.ts`), réduit aux CATÉGORIES.
 *
 * ── UNE FOIS PAR ÉCRAN ───────────────────────────────────────────────────
 * React le relisait à CHAQUE ouverture du panneau Calques (`usePoiCatalog` y est monté). Ici, il est lu à la première
 * ouverture de la section POI, puis gardé jusqu'à la sortie de la carte (cache avant appel, CLAUDE.md) ; « ↻ » le
 * relit explicitement, avec `?refresh=1`. Un échec est repris UNE fois après 800 ms, comme React (le premier appel
 * peut partir avant que Next soit prêt).
 *
 * ── LES NATURES NE SONT PAS PORTÉES ──────────────────────────────────────
 * `fetchPoiNatures` n'est appelé par AUCUN composant de `/map` (`PanneauCalques.tsx:255` le reçoit et ne s'en sert
 * pas) : le sélecteur « Nature » de `PoiSection.tsx:177-194` n'y apparaît donc jamais, et `poi_natures` part toujours
 * vide. Le brancher ferait appeler `/api/map/poi-natures`, qui pagine TOUTES les lignes d'une catégorie avec leur jsonb
 * (famille de l'incident du 28/03) : ce serait une charge nouvelle, pas un port. `CarteApi.poiNatures` reste prêt.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class CataloguePoiService {
  private readonly api = inject(CarteApi);
  private lecture: Subscription | null = null;
  private reprise: ReturnType<typeof setTimeout> | null = null;
  private demande = false;

  readonly types = signal<readonly TypePoi[]>([]);
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      if (this.reprise) clearTimeout(this.reprise);
    });
  }

  /** La première ouverture de la section : une seule lecture par écran. */
  chargerUneFois(): void {
    if (this.demande) return;
    this.demande = true;
    this.charger(false);
  }

  /** « ↻ » (rafraîchir = `?refresh=1`) ; `estReprise` est la reprise automatique, qui ne se reprend pas. */
  charger(rafraichir: boolean, estReprise = false): void {
    this.demande = true;
    this.lecture?.unsubscribe();
    if (this.reprise) { clearTimeout(this.reprise); this.reprise = null; }
    this.chargement.set(true);
    this.erreur.set(null);
    this.lecture = this.api.categories(rafraichir).subscribe({
      next: (data) => {
        this.chargement.set(false);
        if (Array.isArray(data?.categories)) {
          this.types.set(data.categories.map(typeDePoi));
          this.erreur.set(null);
        } else {
          this.erreur.set(data?.error ?? 'Réponse inattendue');
        }
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        if (!estReprise) {
          this.reprise = setTimeout(() => this.charger(rafraichir, true), DELAI_REPRISE_CATEGORIES_MS);
          return;
        }
        this.erreur.set(messageErreurApi(e));
      },
    });
  }
}
