import { Injectable, computed, inject, signal } from '@angular/core';
import { type Observable, type Subscription, map, of } from 'rxjs';
import { PoisService } from '../couches/pois.service';
import { IsochronesApi } from '../data/isochrones.api';
import { refusBorneNationale, refusCapaciteAnneaux, sansTerritoire } from '../logique/bataille/borne-nationale';
import { messageEchecHttp, type PoiCategorise } from '../logique/bataille/flux';
import { type ContexteBataille, corpsVerification, territoireDuFiltre } from '../logique/bataille/parametres';
import type { FiltreActif } from '../logique/filtre';
import { EtatCarteService } from './etat-carte.service';
import { ReferentielGeoService } from './referentiel-geo.service';

/**
 * Ce que les deux batailles d'isochrones (V1 et V2) partagent — la part commune de `use-isochrone-battle.ts` (lot 4,
 * T17) : le mode de transport choisi une fois pour les deux outils, la catégorie de POI (le seul type choisi), le
 * territoire dérivé du filtre unique, et l'affichage des POI de la bataille comme ZONE de points (`setZoneData`).
 *
 * ── LA CAPACITÉ EN DIRECT SUR LA MÉTROPOLE (retours du 26/10, T4) ───────
 * La garde de ④ laisse passer les batailles sur `FILTRE_METROPOLE` (`messageGardeCarte`). Avant de lancer, `sousBorne`
 * compte les POI (`verifierBorne` : UNE vérification du cache, un seul palier, au geste — jamais avant) et refuse ce que
 * `get_isochrone_battle` ne calcule pas sous les 60 s de Kong (`refusBorneNationale`, copie de la borne serveur). Aucune
 * borne produit sur le nombre de points (Vincent, Q-1) : le message promet la tâche de fond. L'écran se règle sur
 * `points × paliers`, plus strict que la route V2 qui ne compte que les anneaux en cache (relecture 1, point 2).
 *
 * « Sur la métropole » se lit comme côté serveur : un contexte SANS territoire (`sansTerritoire`). Après la garde, c'est
 * la seule façon d'en avoir un — absence de filtre, France entière, code postal et zone y sont refusés. Avec un
 * territoire, la capacité de 700 anneaux vaut aussi (Ruling 4) : la V2 n'appelle rien, sa route la refait ; la V1, dont
 * la route est protégée et ne refait rien (Q-3), compte AUSSI avec un territoire (`capaciteLocale`, relecture 2, I-1)
 * et applique `refusCapaciteAnneaux` — même message « tâche de fond », borne côté écran seulement.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ContexteBatailleService {
  private readonly etat = inject(EtatCarteService);
  private readonly referentiel = inject(ReferentielGeoService);
  private readonly poisCarte = inject(PoisService);
  private readonly api = inject(IsochronesApi);

  /** Le dernier refus de capacité, et le filtre sur lequel il a été compté. */
  private readonly refus = signal<{ message: string; filtre: FiltreActif | null } | null>(null);
  /**
   * Le refus de capacité affiché par le panneau Analyse, à côté de sa garde. Dérivé : il disparaît dès que le filtre
   * change (comme la garde), sans effet qui recopie un signal.
   */
  readonly refusBorne = computed(() => {
    const r = this.refus();
    return r && r.filtre === this.etat.filtre() ? r.message : null;
  });

  /** `transportMode` : « Voiture » par défaut. */
  readonly mode = signal('drive');
  /** Les outils n'existent qu'avec EXACTEMENT un type de POI (`exactlyOnePOI`). */
  readonly unPoi = computed(() => this.etat.poiSelectionnes().length === 1);
  /** Le référentiel des régions : la règle « toutes les régions » et le nom du territoire dans le journal. */
  readonly regions = this.referentiel.regions;
  readonly contexte = computed<ContexteBataille>(() => ({
    categorie: this.etat.poiSelectionnes()[0] ?? '',
    mode: this.mode(),
    territoire: territoireDuFiltre(this.etat.filtre()),
    nbRegionsRef: this.referentiel.regions().length,
  }));

  /**
   * Les POI de la bataille deviennent la zone de points affichée (`useMapDirectActions.ts:236-245,493-502`) :
   * marqueurs, badge ZONE_ACTIVE, catégorie dans la légende. Rien sans POI, comme React.
   */
  afficherPois(pois: readonly PoiCategorise[], categorie: string, ville: string | undefined): void {
    if (pois.length === 0) return;
    this.poisCarte.definirZone({
      coordonnees: { lat: pois[0].lat, lng: pois[0].lng },
      pois: [...pois],
      nb_pois: pois.length,
      categories: { [categorie]: pois.length },
      couleur_overrides: {},
      ville: ville ?? '',
      rayon_metres: null,
      rayon_poi_metres: null,
    });
  }

  /**
   * Le refus de capacité d'une bataille, `null` si elle peut partir en direct. UNE lecture de
   * `POST /api/isochrone-cache-check` avec le premier palier seul (son `total_pois` suffit), puis, sur la métropole,
   * `refusBorneNationale(total_pois, paliers.length)` (lecture tronquée et capacité). Avec un territoire : sans
   * `capaciteLocale`, `of(null)` sans appel ; avec, `refusCapaciteAnneaux(total_pois, paliers.length)` (V1).
   */
  verifierBorne(ctx: ContexteBataille, paliers: readonly number[], capaciteLocale = false): Observable<string | null> {
    const corps = corpsVerification(ctx, paliers.slice(0, 1));
    const national = sansTerritoire(corps);
    if (paliers.length === 0 || (!national && !capaciteLocale)) return of(null);
    return this.api.verifierCache(corps).pipe(map((s) => (national
      ? refusBorneNationale(s.total_pois ?? 0, paliers.length)
      : refusCapaciteAnneaux(s.total_pois ?? 0, paliers.length))));
  }

  /**
   * Un lancement sous borne, sur le contexte FIGÉ au clic : `suite()` si le calcul peut partir, sinon le refus noté
   * (`> ✕ <message>`) et affiché par le panneau. Une réponse arrivée après un changement de filtre ne lance rien et ne
   * refuse rien (Review Focus 3) : le lancement suivant recompte sur le nouveau filtre. L'abonnement rendu est annulé
   * par l'appelant (nouveau lancement, « Tout effacer », destruction). Un échec du comptage est noté, rien ne part.
   * `capaciteLocale` : voir `verifierBorne` (la V1 le passe).
   */
  sousBorne(
    ctx: ContexteBataille, paliers: readonly number[], noter: (ligne: string) => void, suite: () => void, capaciteLocale = false,
  ): Subscription {
    const filtre = this.etat.filtre();
    this.refus.set(null);
    return this.verifierBorne(ctx, paliers, capaciteLocale).subscribe({
      next: (message) => {
        if (this.etat.filtre() !== filtre) return;
        if (message === null) { suite(); return; }
        this.refus.set({ message, filtre });
        noter(`> ✕ ${message}`);
      },
      error: (e: unknown) => {
        if (this.etat.filtre() === filtre) noter(`> ✕ Erreur vérif. cache : ${messageEchecHttp(e)}`);
      },
    });
  }

  /** « Tout effacer » : le refus affiché part avec l'outil. */
  oublierRefus(): void {
    this.refus.set(null);
  }
}
