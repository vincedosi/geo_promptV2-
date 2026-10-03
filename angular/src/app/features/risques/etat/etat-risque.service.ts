import { DestroyRef, Injectable, type Signal, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ETAT_DEFAUT, type EtatRisque, ecrireEtatUrl, lireEtatUrl } from '../logique/etat-url';

/**
 * Le paramètre UNIQUE du module dans l'URL (`ContexteRisque.tsx:58`).
 *
 * ⚠ La page hôte porte déjà ses propres paramètres (`/map` : `?campaign=`,
 * `?tab=`, `?overlay=` ; dans AIDA, ceux du shell). Écrire nos champs à plat
 * écraserait les leurs : tout l'état tient donc sous `?risque=`, encodé par
 * `ecrireEtatUrl` — une URL React se colle telle quelle.
 */
export const PARAM_RISQUE = 'risque';

/**
 * L'état unique du module « Population à risque industriel », et son reflet
 * dans l'URL — portage de `ContexteRisque.tsx`.
 *
 * Fourni PAR L'ÉCRAN (`providers` de `RisquePage`, arbitrage A13) : détruit
 * avec lui, comme le fournisseur React démonté à la fermeture de l'overlay.
 *
 * ── LA SYNCHRONISATION D'URL (arbitrage A2) ──────────────────────────────
 *
 * React écrivait par `history.replaceState`, pour ne pas re-rendre la page.
 * Ici l'écriture passe par le `Router` : dans un hôte AIDA, le routeur
 * appartient au shell, et écrire l'historique derrière son dos désynchronise
 * son état. Le `Router` ne recrée pas l'écran pour autant — même route, seuls
 * les paramètres de requête changent, le composant est réutilisé.
 *
 * - `replaceUrl` et non une nouvelle entrée : chaque cran de réglette n'a pas
 *   à créer une entrée d'historique, sinon « retour » demanderait trente
 *   clics pour quitter l'écran.
 * - Navigation RELATIVE à la route de l'écran : le préfixe de montage est
 *   inconnu (shell).
 * - `queryParamsHandling: 'merge'` : les paramètres de l'hôte sont gardés.
 *
 * L'URL est lue à la construction — comme React, qui la lisait au montage —
 * PUIS à chaque changement de `?risque=` qui ne vient pas de nous : une
 * navigation de requête RÉUTILISE l'écran (même route), et sans cette écoute
 * un lien suivi depuis l'écran ouvert (retour, lien collé, shell) changerait
 * l'URL sans changer l'état. Une URL collée malformée ou ancienne
 * (`onglet=territoires`, `fusion=oui`, profil illisible, `jeu=` non-UUID)
 * donne un état PARTIELLEMENT récupéré, jamais une exception : `lireEtatUrl`
 * ne lève pas.
 */
@Injectable()
export class EtatRisqueService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** La valeur brute de `?risque=` à l'ouverture. */
  private readonly brut = this.route.snapshot.queryParamMap.get(PARAM_RISQUE);
  private readonly courant = signal<EtatRisque>(lireEtatUrl(new URLSearchParams(this.brut ?? '')));

  readonly etat: Signal<EtatRisque> = this.courant.asReadonly();

  /**
   * Le dernier encodage écrit (`ContexteRisque.tsx:82-92`) : sans lui, chaque
   * passe réécrirait l'URL. Il part de la valeur LUE : une URL déjà canonique
   * ne provoque aucune navigation à l'ouverture, alors qu'un alias hérité
   * (`onglet=territoires`) est réécrit une fois sous sa forme courante.
   */
  private dernier: string = this.brut ?? '';

  constructor() {
    // Un `?risque=` différent du DERNIER écrit vient d'ailleurs : on le relit. Nos propres navigations rendent la
    // valeur déjà notée dans `dernier`, donc ne repassent pas par ici. Désabonnement explicite (pas de
    // `rxjs-interop`, NG0203 dans un hôte par défaut).
    const abonnement = this.route.queryParamMap.subscribe((params) => {
      const brut = params.get(PARAM_RISQUE) ?? '';
      if (brut === this.dernier) return;
      this.dernier = brut;
      this.courant.set(lireEtatUrl(new URLSearchParams(brut)));
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());

    // `effect` dans le constructeur seulement : hors contexte d'injection, NG0203.
    effect(() => {
      const encode = ecrireEtatUrl(this.courant());
      if (encode === this.dernier) return;
      this.dernier = encode;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [PARAM_RISQUE]: encode === '' ? null : encode },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  /** Applique une modification partielle. Les champs absents ne bougent pas. */
  maj(partiel: Partial<EtatRisque>): void {
    this.courant.update((e) => ({ ...e, ...partiel }));
  }

  /** Remet l'état d'ouverture, sans quitter le module. */
  reinitialiser(): void {
    this.courant.set(ETAT_DEFAUT);
  }
}
