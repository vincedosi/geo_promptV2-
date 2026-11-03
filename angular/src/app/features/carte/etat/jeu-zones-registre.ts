import { type Signal, computed } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ReponsePlateformes } from '../data/jeux.api';
import { messageErreurCouverture } from '../logique/analyses/couverture-erreurs';
import { choixASimuler, defautsDe } from '../logique/jeu/bilan';
import type { Plateforme, PlateformeGeo } from '../logique/jeu/plateformes';
import type { Recette } from '../logique/zones/recette';
import { LectureAnnulable } from './lecture-annulable';

/**
 * ⑤ Jeu de zones — le REGISTRE des plateformes tel que `GET /api/zones/plateformes` le rend (sorti de
 * `JeuZonesService` pour son plafond de 400 lignes, B16, à comportement constant) : `plateformes_geo`, les mécanismes
 * de poids (`plateformes_poids`, B16) et les réglages de la maille par défaut (sql/315), lus UNE fois par page. Tout ce
 * qui décide du défaut à partir d'eux (`defautsDe`, `choixASimuler`) passe par ici, pour que la règle reçoive toujours
 * le registre ENTIER. À créer dans un contexte d'injection (initialiseur de champ) : `LectureAnnulable` y prend son
 * `DestroyRef`.
 */
export class RegistrePlateformes {
  private readonly lecture = new LectureAnnulable<ReponsePlateformes>(messageErreurCouverture);

  /** Le registre `plateformes_geo`, vide tant qu'il n'est pas lu. */
  readonly plateformes: Signal<readonly PlateformeGeo[]> = computed(() => this.lecture.resultat()?.plateformes ?? []);
  /** Le message d'une lecture du registre en échec ; `null` sinon. */
  readonly erreur: Signal<string | null> = this.lecture.erreur.asReadonly();

  /** Lit le registre s'il n'est ni lu ni en vol (une lecture par page ; un échec se relit au prochain appel). */
  charger(source: () => Observable<ReponsePlateformes>): void {
    this.lecture.chargerUneFois(source);
  }

  /** `defautsDe` sur le registre lu (B9, ARB-7) — les lectures en mémoire et leurs échecs sont ceux du service. */
  defauts(
    recette: Recette | null, lu: Parameters<typeof defautsDe>[3], echec: Parameters<typeof defautsDe>[4], surface_km2: number | null,
  ): ReturnType<typeof defautsDe> {
    const r = this.lecture.resultat();
    return defautsDe(this.plateformes(), recette, r?.reglages_defaut, lu, echec, surface_km2, r?.poids ?? []);
  }

  /** `choixASimuler` sur le registre lu : les simulations qui décident du défaut de la plateforme. */
  aSimuler(p: Plateforme, recette: Recette | null, surface_km2: number | null): ReturnType<typeof choixASimuler> {
    return choixASimuler(this.plateformes(), p, recette, surface_km2, this.lecture.resultat()?.poids ?? []);
  }
}
