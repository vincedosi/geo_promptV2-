/**
 * ⑤ Jeu de zones — revue T6 (I-1, I-2) : ce que l'écran DIT d'une maille sans objet (`mailleSansObjet`), et la zone
 * « nationale moins des zones locales » (C21) vue depuis la liste des zones de l'espace. Logique PURE, sans Angular.
 *
 * Le conseil nomme les mailles de CETTE plateforme qui restent, lues dans ses lignes de `plateformes_geo` — jamais
 * une maille écrite ici : « choisissez le découpage par code postal » s'affichait chez TikTok, qui n'achète pas au CP,
 * et « choisissez le pays » sur une zone nationale moins des zones locales, où le pays est lui-même sans objet.
 */
import type { Recette, ZoneConnue } from '../zones/recette';
import { mailleSansObjet } from './conversion';
import type { Maille, PlateformeGeo } from './plateformes';

/** Ce qui est sans objet, par maille (les effectifs nationaux sont ceux des refus de couverture, sql/296). */
const CONSTAT: Partial<Record<Maille, string>> = {
  cercle: 'le ciblage par cercles n’a pas de sens',
  commune: 'le découpage par commune (34 918) est trop fin',
  iris: 'le découpage par IRIS (48 872) est trop fin',
};

/** Une maille dans « choisissez … ». */
const DESIGNATION: Readonly<Record<Maille, string>> = {
  polygone: 'le polygone', cp: 'le code postal', iris: 'l’IRIS', commune: 'la commune', departement: 'le département',
  cercle: 'les cercles', pays: 'le pays',
};

/** « a », « a ou b », « a, b ou c ». */
function ou(termes: readonly string[]): string {
  return termes.length < 2 ? termes.join('') : `${termes.slice(0, -1).join(', ')} ou ${termes[termes.length - 1]}`;
}

/**
 * La phrase d'une maille sans objet pour la recette, avec les mailles DISPONIBLES de la plateforme (`lignes`, ordre du
 * registre) qui gardent un sens ; `null` si la maille a un sens. La maille pays hors zone nationale garde la phrase de
 * la règle (l'écran ne l'affiche pas).
 */
export function phraseSansObjet(maille: Maille, lignes: readonly PlateformeGeo[], recette: Recette | null, nationaleMoins: boolean): string | null {
  const raison = mailleSansObjet(recette, maille, nationaleMoins);
  if (!raison || maille === 'pays') return raison;
  const restantes = [...lignes].sort((a, b) => a.ordre - b.ordre)
    .filter((l) => l.disponible && l.maille !== maille && mailleSansObjet(recette, l.maille, nationaleMoins) === null)
    .map((l) => DESIGNATION[l.maille]);
  const conseil = restantes.length > 0 ? `choisissez ${ou(restantes)}` : 'aucune autre maille de cette plateforme ne convient';
  return `Sur une zone nationale, ${CONSTAT[maille] ?? 'cette maille n’a pas de sens'} : ${conseil}.`;
}

/**
 * C21 : la zone est-elle une différence dont la PREMIÈRE zone est une zone pays (« France métropolitaine moins Lyon ») ?
 * `sources` : les zones de l'espace (liste de « Zone »), où se lit la recette de la première ; inconnue, faux — le
 * serveur, lui, le lit en base (`estNationaleMoins`, `lib/zones/couverture.ts`) et refuse l'enregistrement.
 */
export function estNationaleMoins(recette: Recette | null, sources: ReadonlyMap<string, ZoneConnue>): boolean {
  if (recette?.type !== 'combinaison' || recette.operation !== 'difference') return false;
  return sources.get(recette.zones[0] ?? '')?.recette?.type === 'pays';
}
