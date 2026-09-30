import { DestroyRef, ElementRef, effect, inject, untracked } from '@angular/core';
import { DemarrageService } from '../core/demarrage/demarrage.service';
import { ADOPTER_FEUILLE } from '../core/ressources/feuille-ombre';
import { ThemeService } from '../core/theme/theme.service';

/**
 * À appeler dans le constructeur d'un composant `ViewEncapsulation.ShadowDom`
 * qui porte une racine MAGELIAN (`RacineDistanteComponent`, et la page de
 * connexion autonome, qui vit hors d'elle) :
 * - adopte la feuille globale construite au démarrage — ou, si le démarrage a
 *   échoué sur elle, dès qu'une relance la construit (le message d'erreur
 *   s'affiche sans style en attendant, le seul cas où il ne peut pas en être
 *   autrement) ; LÈVE si le composant n'a pas de
 *   racine d'ombre alors qu'une feuille existe — jamais d'écran sans style en
 *   silence ;
 * - enregistre l'élément hôte auprès de `ThemeService`, qui y reflète la
 *   classe `light`/`dark` (`:host(.light)` dans jetons.css) et que
 *   `CouleursService` lit — `<html>` n'est jamais écrit pour cela.
 */
export function monterRacineOmbre(): void {
  const hote = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const ombre = hote.shadowRoot;
  const demarrage = inject(DemarrageService);
  const adopter = inject(ADOPTER_FEUILLE);
  const poser = (feuille: CSSStyleSheet) => {
    // Pas de repli silencieux : sans racine d'ombre, la feuille n'a nulle part
    // où aller et l'écran s'afficherait sans aucun style.
    if (!ombre) {
      throw new Error(
        `MAGELIAN : <${hote.localName}> doit être déclaré en ViewEncapsulation.ShadowDom — ` +
        "sa feuille de style globale ne peut être adoptée que par une racine d'ombre.",
      );
    }
    adopter(ombre, feuille);
  };
  const feuille = demarrage.feuille();
  if (feuille) {
    poser(feuille);
  } else {
    // Démarrage en échec sur la feuille : la racine affiche l'erreur sans
    // style. Une relance réussie (navigation suivante) construit la feuille,
    // et cette racine, créée PENDANT l'échec, l'adopte alors — une fois :
    // l'effet se détruit après l'avoir posée.
    const suivi = effect(() => {
      const arrivee = demarrage.feuille();
      if (!arrivee) return;
      untracked(() => poser(arrivee));
      suivi.destroy();
    });
  }
  inject(DestroyRef).onDestroy(inject(ThemeService).enregistrerRacine(hote));
}
