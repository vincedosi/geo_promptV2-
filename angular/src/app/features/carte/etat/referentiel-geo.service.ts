import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ReferentielApi } from '../../risques/data/referentiel.api';

/** Un département du référentiel (`ref_departements`) — `RefDept` de `lib/geo/use-ref-geo.ts`. */
export interface DepartementRef {
  code_dept: string;
  nom_dept: string;
}

/** Une région du référentiel (`ref_regions`) et ses départements — `RefRegion` de `lib/geo/use-ref-geo.ts`. */
export interface RegionRef {
  code_region: string;
  nom_region: string;
  depts: DepartementRef[];
}

/**
 * Le référentiel régions / départements INSEE de la carte, lu UNE fois par écran — portage de `useRefGeo`
 * (`lib/geo/use-ref-geo.ts`). React le gardait dans un cache de MODULE (partagé par toute l'application) ;
 * ici il vit dans un service fourni par la page carte : un cache par écran, détruit avec lui (règle « cache
 * avant appel » du lot). `charger()` est idempotent : rouvrir le panneau Filtre ne relit rien.
 *
 * Défaut React corrigé : un ÉCHEC laissait les listes vides et leur libellé sur « Chargement… » sans fin.
 * Ici `erreur` le dit, et l'échec n'est pas mémorisé — l'ouverture suivante du panneau réessaie.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte.
 */
@Injectable()
export class ReferentielGeoService {
  private readonly api = inject(ReferentielApi);
  private abonnement: Subscription | null = null;
  private enCours = false;
  private charge = false;

  private readonly _regions = signal<readonly RegionRef[]>([]);
  readonly regions = this._regions.asReadonly();
  /** Liste aplatie des départements, triée par code (`useRefGeo().allDepts`). */
  readonly departements = computed<readonly DepartementRef[]>(() =>
    this._regions().flatMap((r) => r.depts).sort((a, b) => a.code_dept.localeCompare(b.code_dept)),
  );
  private readonly _erreur = signal<string | null>(null);
  readonly erreur = this._erreur.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  charger(): void {
    if (this.charge || this.enCours) return;
    this.enCours = true;
    this._erreur.set(null);
    this.abonnement = this.api.geo().subscribe({
      next: (r) => {
        this._regions.set((r.regions ?? []).map((g) => ({
          code_region: g.code_region,
          nom_region: g.nom_region,
          depts: (g.depts ?? []).map((d) => ({ code_dept: d.code_dept, nom_dept: d.nom_dept })),
        })));
        this.charge = true;
        this.enCours = false;
      },
      error: () => {
        this._erreur.set('Référentiel indisponible');
        this.enCours = false;
      },
    });
  }
}
