import { Injectable, inject } from '@angular/core';
import { type Observable, catchError, map, shareReplay, throwError } from 'rxjs';
import { AnalysesApi } from '../data/analyses.api';
import type { IndicateurRegistre } from '../logique/analyses/score';

/**
 * Le catalogue d'indicateurs (`GET /api/cibles/indicators`) que le score composite ET la corrélation proposent (lot 4,
 * T18) : lu au PREMIER dépliage de l'un des deux, jamais au montage (pas de préchargement — CLAUDE.md), et partagé.
 * React le lisait une fois par outil, deux lectures de la même liste.
 *
 * Une lecture EN VOL est partagée (`shareReplay`) ; un échec n'est pas retenu : le dépliage suivant relit, comme le
 * `catalogueRef.current = false` de React.
 *
 * `@Injectable()` sans `providedIn` : fourni par la PAGE carte (lot 3, X4) — une lecture par page, partagée par
 * Analyse (score, corrélation), ③ (« Par seuil », pied de recette) et « Mes zones ». Un changement d'espace recrée la
 * page, donc le catalogue (il dépend des droits de l'espace).
 */
@Injectable()
export class CatalogueIndicateursService {
  private readonly api = inject(AnalysesApi);
  private lecture: Observable<IndicateurRegistre[]> | null = null;

  charger(): Observable<IndicateurRegistre[]> {
    this.lecture ??= this.api.indicateurs().pipe(
      map((r) => (Array.isArray(r.indicators) ? r.indicators : [])),
      catchError((e: unknown) => {
        this.lecture = null;
        return throwError(() => e);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.lecture;
  }
}
