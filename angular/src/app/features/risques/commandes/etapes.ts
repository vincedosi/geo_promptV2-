import type { EtapeAffichee } from '../../../ui/fil-etapes/fil-etapes.component';
import { ETAPES, LIBELLE_ETAPE, etapeRenseignee, rangEtape } from '../logique/etape';
import type { EtatRisque } from '../logique/etat-url';

/**
 * Les cinq étapes telles que `mg-fil-etapes` les affiche — l'adaptation de
 * `FilArianeEtapes.tsx` (React), qui calculait rang, libellé et pastille dans
 * son rendu. Ici une fonction PURE, appelée par un `computed` de l'écran : le
 * fil ne se redessine que si l'état ou la simulation change.
 *
 * @param etat - L'état du module (gravités, profil, chemin, jeu).
 * @param simulation - Une campagne a été simulée sur le jeu ouvert (étape ⑤).
 * @returns Les cinq étapes, dans l'ordre du parcours, rangs 1 à 5.
 */
export function etapesAffichees(etat: EtatRisque, simulation: boolean): EtapeAffichee[] {
  const parcours = {
    gravites: etat.gravites,
    profil: etat.profil,
    chemin: etat.chemin,
    jeu: etat.jeu,
    simulation,
  };
  return ETAPES.map((e) => ({
    cle: e,
    rang: rangEtape(e),
    libelle: LIBELLE_ETAPE[e],
    renseignee: etapeRenseignee(e, parcours),
  }));
}
