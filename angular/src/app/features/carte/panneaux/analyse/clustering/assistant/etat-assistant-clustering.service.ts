/**
 * L'état de l'assistant de clustering en quatre étapes (lot 4, T20), partagé par ses étapes et oublié à sa
 * fermeture.
 */
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ClusteringApi } from '../../../../data/clustering.api';
import { ReferentielGeoService } from '../../../../etat/referentiel-geo.service';
import {
  DUREE_INITIALE_ASSISTANT, type Transport, type TypePoiClustering, corpsLancement, departementsChoisis, peutLancer, regionsProposees,
} from '../../../../logique/clustering/assistant';
import { ALL_FEATURES, type ThemeId } from '../../../../logique/clustering/feature-themes';
import { CalculClusteringService } from '../calcul-clustering.service';

export type EtapeAssistant = 1 | 2 | 3 | 4;

/**
 * L'état de l'assistant de clustering — les `useState` de `ClusteringWizard.tsx:99-131`, partagés par ses quatre
 * étapes (lot 4, T20). Fourni par `mg-assistant-clustering` : le fermer oublie tout, comme le démontage du wizard React.
 *
 * Les types de POI sont lus à la construction (`useEffect([], …)` au montage), le comptage à chaque entrée dans
 * l'étape 3 (`refreshCount`). Le référentiel des régions (`useRefGeo`) est déjà demandé par le panneau Analyse, qui
 * porte l'assistant : rien à relire ici. Le job lui-même vit dans `CalculClusteringService` (panneau Analyse, derrière la garde).
 */
@Injectable()
export class EtatAssistantClusteringService {
  private readonly api = inject(ClusteringApi);
  private readonly referentiel = inject(ReferentielGeoService);
  private readonly calcul = inject(CalculClusteringService);

  // Étape 1 — les types de POI.
  readonly typesPoi = signal<TypePoiClustering[]>([]);
  readonly chargementTypes = signal(true);
  readonly types = signal<string[]>([]);

  // Étape 2 — le périmètre géographique propre à l'assistant (indépendant du filtre de la carte, comme React).
  readonly metropolitaine = signal(true);
  readonly regions = signal<string[]>([]);
  readonly regionsProposees = computed(() => regionsProposees(this.referentiel.regions(), this.metropolitaine()));
  readonly depts = computed(() => departementsChoisis(this.referentiel.regions(), this.regions(), this.metropolitaine()));
  /** Le référentiel n'est pas encore là (« Chargement des régions… »). */
  readonly referentielVide = computed(() => this.referentiel.regions().length === 0);

  // Étape 3 — les paramètres.
  readonly duree = signal(DUREE_INITIALE_ASSISTANT);
  readonly transport = signal<Transport>('drive');
  readonly dryRun = signal(false);
  readonly variables = signal<string[]>([...ALL_FEATURES]);
  readonly themesOuverts = signal<ReadonlySet<ThemeId>>(new Set());
  readonly comptage = signal<number | null>(null);
  readonly chargementComptage = signal(false);

  /** L'étape choisie par la navigation ; un job lancé emmène à l'étape 4 (`setStep(4)` après le POST). */
  private readonly etapeChoisie = signal<Exclude<EtapeAssistant, 4>>(1);
  readonly etape = computed<EtapeAssistant>(() => (this.calcul.jobId() ? 4 : this.etapeChoisie()));

  readonly peutLancer = computed(() => peutLancer({
    types: this.types().length, duree: this.duree(), variables: this.variables().length, enCours: this.calcul.lancement(),
  }));
  readonly corps = computed(() => corpsLancement({
    types: this.types(), metropolitaine: this.metropolitaine(), regions: this.regions(), depts: this.depts(),
    duree: this.duree(), transport: this.transport(), dryRun: this.dryRun(), variables: this.variables(),
  }));

  private lectureComptage: Subscription | null = null;

  constructor() {
    const lectureTypes = this.api.typesPoi().subscribe({
      next: (t) => this.typesPoi.set(t),
      // `.catch(() => setPoiTypes([]))` : la liste reste vide, l'étape le montre.
      error: () => { this.typesPoi.set([]); this.chargementTypes.set(false); },
      complete: () => this.chargementTypes.set(false),
    });
    inject(DestroyRef).onDestroy(() => { lectureTypes.unsubscribe(); this.lectureComptage?.unsubscribe(); });
  }

  /** « Suivant » (étapes 1 et 2) : une étape de plus ; l'entrée dans l'étape 3 relance le comptage. */
  suivant(): void {
    if (this.types().length === 0) return;
    const e = this.etapeChoisie();
    if (e === 1) this.etapeChoisie.set(2);
    else if (e === 2) { this.etapeChoisie.set(3); this.compter(); }
  }

  /** « Retour » (étapes 2 et 3). */
  retour(): void {
    const e = this.etapeChoisie();
    if (e > 1) this.etapeChoisie.set((e - 1) as 1 | 2);
  }

  private compter(): void {
    this.lectureComptage?.unsubscribe();
    this.chargementComptage.set(true);
    this.lectureComptage = this.api.compter(this.types(), this.metropolitaine(), this.depts()).subscribe({
      next: (n) => { this.comptage.set(n); this.chargementComptage.set(false); },
      // « Erreur comptage » : `setPoiCount(null)`.
      error: () => { this.comptage.set(null); this.chargementComptage.set(false); },
    });
  }
}
