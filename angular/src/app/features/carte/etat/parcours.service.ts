import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ETAPE_PAR_DEFAUT, type EtapeCarte, PARAM_ETAPE, VUE_AUTRES, type VueParcours, ecrireEtape, etapeInitiale, lireEtape,
} from '../logique/parcours';

/**
 * L'étape courante du parcours de la carte, et son reflet dans `?etape=` (spec § 5) — patron EXACT de
 * `EtatRisqueService` (`features/risques/etat/etat-risque.service.ts`) : lu à la construction, réécrit à chaque geste
 * (`replaceUrl`, `merge`, navigation RELATIVE), relu à chaque `?etape=` qui ne vient pas de nous. Une navigation de
 * requête RÉUTILISE la page : changer d'étape ne recrée rien.
 *
 * `visitees` : les vues déjà ouvertes (étapes, et « Autres »). Leur panneau est monté à la première visite puis GARDÉ
 * (arbitrage A1) — un calcul en cours survit au changement d'étape, et revenir ne relit rien.
 *
 * « Autres » (T11b) : hors du fil, `?etape=autres`. L'ouvrir ne change pas `etape` (l'étape d'en dessous, celle du fil
 * quand on y revient) ; choisir une étape le referme. `vue` est ce que montre le panneau.
 *
 * Écriture relative à la route ENFANT active quand il y en a une (le module risque, `carte/risques`) : relative à la
 * carte, `navigate([])` fermerait le module.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle (un changement d'espace la recrée).
 */
@Injectable()
export class ParcoursService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly courante = signal<EtapeCarte>(etapeInitiale(this.route.snapshot.queryParamMap));
  readonly etape: Signal<EtapeCarte> = this.courante.asReadonly();
  private readonly _autres = signal(this.route.snapshot.queryParamMap.get(PARAM_ETAPE) === VUE_AUTRES);
  /** « Autres » est-il ouvert ? Aucune étape n'est alors courante dans le fil. */
  readonly autres: Signal<boolean> = this._autres.asReadonly();
  /** Ce que montre le panneau flottant : l'étape courante, ou « Autres ». */
  readonly vue: Signal<VueParcours> = computed(() => (this._autres() ? VUE_AUTRES : this.courante()));
  private readonly _visitees = signal<ReadonlySet<VueParcours>>(new Set([this.vue()]));
  readonly visitees: Signal<ReadonlySet<VueParcours>> = this._visitees.asReadonly();
  /**
   * Le dernier `?etape=` écrit OU lu, tel que l'URL le porte : `null` = paramètre ABSENT, `''` = présent mais vide.
   * La distinction est le point : `/carte?etape=` (vide) est lu comme ① mais n'est pas la forme canonique `/carte`,
   * il doit être réécrit une fois. Sans ce mémo, chaque passe réécrirait l'URL.
   */
  private dernier: string | null = this.route.snapshot.queryParamMap.get(PARAM_ETAPE);

  constructor() {
    const abonnement = this.route.queryParamMap.subscribe((p) => {
      const brut = p.get(PARAM_ETAPE);
      if (brut === this.dernier) return;
      this.dernier = brut;
      if (brut === VUE_AUTRES) this.ouvrirAutres();
      else this.poser(lireEtape(brut) ?? ETAPE_PAR_DEFAUT);
      // Une valeur illisible alors que l'étape est DÉJÀ ① ne fait pas bouger le signal : l'effet ne repasserait pas.
      this.ecrire();
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());

    effect(() => {
      this.vue();
      this.ecrire();
    });
  }

  /** Écrit la vue courante sous sa forme canonique (défaut = paramètre absent), si l'URL n'est pas déjà celle-là. */
  private ecrire(): void {
    const encode = this._autres() ? VUE_AUTRES : ecrireEtape(this.courante());
    const canonique = encode === '' ? null : encode;
    if (canonique === this.dernier) return;
    this.dernier = canonique;
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams: { [PARAM_ETAPE]: canonique },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Choisir une étape referme « Autres ». */
  choisir(e: EtapeCarte): void {
    this.poser(e);
  }

  /** Ouvre « Autres » (bouton de la barre, hors du fil) ; déjà ouvert, ne fait rien. */
  ouvrirAutres(): void {
    this._autres.set(true);
    this.visiter(VUE_AUTRES);
  }

  private poser(e: EtapeCarte): void {
    this._autres.set(false);
    this.courante.set(e);
    this.visiter(e);
  }

  private visiter(v: VueParcours): void {
    this._visitees.update((s) => (s.has(v) ? s : new Set([...s, v])));
  }
}
