/**
 * ⑤ Jeu de zones — les paramètres d'une ligne de `plateformes_geo` déclarés « à vérifier » (`parametres_a_verifier`,
 * amendement E9), chacun à côté de sa valeur, ou « non relevé » quand la base n'en porte aucune (C28 : DV360, CP par
 * liste, cercles par liste de proximité, rayon maximal). Logique PURE, affichage seulement : aucune règle n'en dépend
 * (la sûreté d'une maille se lit dans `mailleSure`, conversion-defaut.ts). Les comportements des minimums ont leur
 * propre avertissement (`controlerPopulation`).
 *
 * Revue T6 (I-9, règle 4) : aussi la règle de groupe des CP (`poids_groupe_cp`), les bornes du polygone
 * (`polygone_sommets_max`, `polygone_morceaux_max`) et les paramètres « à vérifier » des mécanismes de poids de la
 * maille (`plateformes_poids` : plage, entrées par envoi, mécanisme) — ils décident de ce que reçoit la plateforme.
 */
import { formaterNombre } from '../../../../core/format/nombre';
import type { MecanismePoussee } from './conversion-defaut';
import { M_PAR_KM } from './ecran';
import type { PlateformeGeo } from './plateformes';

type Borne = keyof PlateformeGeo['limites'];

/**
 * Une ligne de `plateformes_poids` telle que `GET /api/zones/plateformes` la rend (`PlateformePoidsSchema`) : ce qu'en
 * lisent le mode de poussée (`MecanismePoussee`) et ce texte. Les champs absents d'une réponse ancienne : non relevés.
 */
export interface PoidsVerifiable extends MecanismePoussee {
  valeur_min?: number | null;
  valeur_max?: number | null;
  nb_max_entrees?: number | null;
  parametres_a_verifier?: readonly string[];
}

/** Les bornes dites, dans l'ordre d'affichage ; `max_unites` prend le nom des unités de la maille. */
const BORNES: readonly Borne[] = ['max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe', 'rayon_min_categorie_speciale'];

const LIBELLES: Record<Exclude<Borne, 'max_unites'>, string> = {
  rayon_min_m: 'rayon minimal', rayon_max_m: 'rayon maximal', pop_min_unite: 'population minimale par unité',
  pop_min_groupe: 'population minimale par groupe', max_sommets: 'sommets maximaux',
  rayon_min_categorie_speciale: 'rayon minimal en catégorie spéciale',
};

const UNITES_PAR_LISTE: Partial<Record<PlateformeGeo['maille'], string>> = {
  cp: 'codes postaux par liste', cercle: 'cercles par liste', commune: 'communes par groupe',
  departement: 'départements par groupe', iris: 'IRIS par liste',
};

/** La règle de groupe des CP (`poids_groupe_cp`, sql/304) : ce que reçoit chaque code d'un groupe indiscernable. */
const GROUPE_CP: Readonly<Record<string, string>> = { meme: 'le même pour chaque code', divise: 'divisé entre ses codes' };

/** « du multiplicateur », « du script »… : le mécanisme de poids dans « plage … », « entrées par envoi … ». */
const DU_MECANISME: Readonly<Record<string, string>> = {
  multiplicateur: 'du multiplicateur', script: 'du script', budget_ligne: 'du budget par ligne', aucun: 'sans poids',
};

const nombre = (v: number | null | undefined) => (v === undefined || v === null ? 'non relevé' : formaterNombre(v));

function valeur(b: Borne, v: number | undefined): string {
  if (v === undefined) return 'non relevé';
  return b === 'rayon_min_m' || b === 'rayon_max_m' || b === 'rayon_min_categorie_speciale' ? `${formaterNombre(v / M_PAR_KM)} km` : formaterNombre(v);
}

/** Les paramètres « à vérifier » des mécanismes de poids de la maille, chacun avec sa valeur. */
function morceauxPoids(ligne: PlateformeGeo, poids: readonly PoidsVerifiable[]): string[] {
  return poids.filter((m) => m.plateforme === ligne.plateforme && m.maille === ligne.maille).flatMap((m) => {
    const verifier = m.parametres_a_verifier ?? [];
    const du = DU_MECANISME[m.mecanisme] ?? m.mecanisme;
    const sortie: string[] = [];
    if (verifier.includes('mecanisme')) sortie.push(`mécanisme de poids, ${m.mecanisme === 'aucun' ? 'aucun (la liste part sans poids)' : m.mecanisme}`);
    if (verifier.includes('valeur_min') || verifier.includes('valeur_max')) {
      sortie.push(`plage ${du}, ${m.valeur_min == null || m.valeur_max == null ? 'non relevée' : `×${formaterNombre(m.valeur_min)} à ×${formaterNombre(m.valeur_max)}`}`);
    }
    if (verifier.includes('nb_max_entrees')) sortie.push(`entrées par envoi ${du}, ${nombre(m.nb_max_entrees)}`);
    return sortie;
  });
}

/**
 * « À vérifier : cercles par liste, non relevé ; rayon maximal, non relevé. » ; `null` si aucun paramètre n'est à
 * vérifier. `poids` : les mécanismes de poids du registre (`plateformes_poids`), filtrés ici sur la maille de la ligne.
 */
export function texteParametresAVerifier(ligne: PlateformeGeo | undefined, poids: readonly PoidsVerifiable[] = []): string | null {
  if (!ligne) return null;
  const verifier: readonly string[] = ligne.parametres_a_verifier ?? [];
  const morceaux = BORNES.filter((b) => verifier.includes(b)).map((b) => {
    const nom = b === 'max_unites' ? UNITES_PAR_LISTE[ligne.maille] ?? 'unités par liste' : LIBELLES[b];
    return `${nom}, ${valeur(b, ligne.limites[b])}`;
  });
  const groupe = verifier.includes('poids_groupe_cp')
    || poids.some((m) => m.plateforme === ligne.plateforme && m.maille === ligne.maille && (m.parametres_a_verifier ?? []).includes('poids_groupe_cp'));
  if (groupe) morceaux.push(`poids d’un groupe de codes postaux, ${GROUPE_CP[ligne.poids_groupe_cp ?? ''] ?? 'non relevé'}`);
  if (verifier.includes('polygone_sommets_max')) morceaux.push(`sommets du polygone, ${nombre(ligne.polygone_sommets_max)}`);
  if (verifier.includes('polygone_morceaux_max')) morceaux.push(`morceaux du polygone, ${nombre(ligne.polygone_morceaux_max)}`);
  morceaux.push(...morceauxPoids(ligne, poids));
  return morceaux.length ? `À vérifier : ${morceaux.join(' ; ')}.` : null;
}
