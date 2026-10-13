import { DestroyRef, Injectable, type Signal, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ETAPE_PAR_DEFAUT, type EtapeCarte, PARAM_ETAPE, ecrireEtape, etapeInitiale, lireEtape } from '../logique/parcours';

/**
 * L'étape courante du parcours de la carte, et son reflet dans `?etape=` (spec § 5) — patron EXACT de
 * `EtatRisqueService` (`features/risques/etat/etat-risque.service.ts`) : lu à la construction, réécrit à chaque geste
 * (`replaceUrl`, `merge`, navigation RELATIVE), relu à chaque `?etape=` qui ne vient pas de nous. Une navigation de
 * requête RÉUTILISE la page : changer d'étape ne recrée rien.
 *
 * `visitees` : les étapes déjà ouvertes. Leur panneau est monté à la première visite puis GARDÉ (arbitrage A1) — un
 * calcul en cours survit au changement d'étape, et revenir ne relit rien.
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
  private readonly _visitees = signal<ReadonlySet<EtapeCarte>>(new Set([this.courante()]));
  readonly visitees: Signal<ReadonlySet<EtapeCarte>> = this._visitees.asReadonly();
  /** Le dernier `?etape=` écrit OU lu : sans lui, chaque passe réécrirait l'URL. Une valeur illisible est réécrite une fois. */
  private dernier = this.route.snapshot.queryParamMap.get(PARAM_ETAPE) ?? '';

  constructor() {
    const abonnement = this.route.queryParamMap.subscribe((p) => {
      const brut = p.get(PARAM_ETAPE) ?? '';
      if (brut === this.dernier) return;
      this.dernier = brut;
      this.poser(lireEtape(brut) ?? ETAPE_PAR_DEFAUT);
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());

    effect(() => {
      const encode = ecrireEtape(this.courante());
      if (encode === this.dernier) return;
      this.dernier = encode;
      void this.router.navigate([], {
        relativeTo: this.route.firstChild ?? this.route,
        queryParams: { [PARAM_ETAPE]: encode === '' ? null : encode },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  choisir(e: EtapeCarte): void {
    this.poser(e);
  }

  private poser(e: EtapeCarte): void {
    this.courante.set(e);
    this._visitees.update((s) => (s.has(e) ? s : new Set([...s, e])));
  }
}
