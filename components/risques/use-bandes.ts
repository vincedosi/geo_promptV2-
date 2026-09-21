'use client';

/**
 * Chargement de la population par classe d'un profil de rayons.
 *
 * ── POURQUOI UN HOOK ET PAS UN APPEL DANS LE COMPOSANT ───────────────────
 *
 * Trois consommateurs partagent la même réponse : le bandeau de KPI, le
 * tableau des bandes et les chips du panneau de profil, qui affichent ce que
 * chaque anneau apporte. Trois appels indépendants feraient trois fois le
 * calcul pour le même profil — et à 2,8 s l'unité sur la France, cela se voit.
 *
 * ── LE DÉBOUNCE, ET CE QU'IL ÉVITE ───────────────────────────────────────
 *
 * Régler un profil, c'est ajouter puis retirer puis déplacer des anneaux : une
 * rafale de gestes en quelques secondes. Sans délai, chacun lance un calcul, et
 * le quota de 30 appels par minute mord sur l'usage normal — c'est exactement
 * le défaut signalé sur l'ancien champ de rayon, où quatre pressions sur une
 * flèche valaient quatre requêtes de 4 s et un 429.
 *
 * ── LA COURSE, ET POURQUOI ELLE COMPTE ICI ───────────────────────────────
 *
 * Deux profils lancés coup sur coup peuvent revenir dans le désordre : le
 * second calcul porte sur moins de carreaux et double le premier. L'écran
 * afficherait alors les chiffres d'un profil que plus personne ne regarde, sans
 * rien pour le signaler — un résultat plausible et faux. Chaque requête porte
 * donc un jeton, et seule la dernière a le droit d'écrire.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { codeProfil } from '@/lib/risques/code-profil';
import type { ProfilRayons } from '@/lib/risques/profil';
import type { Dimension } from '@/lib/risques/dimensions';

/** Une unité territoriale et sa ventilation par classe. */
export interface UniteBandes {
  unite: string;
  /** Libellé lisible. `null` si le référentiel ne connaît pas ce code. */
  nom: string | null;
  total: number;
  classes: Record<string, number>;
  /**
   * Population totale de l'unité — le DÉNOMINATEUR de la part.
   *
   * ⚠ `null` à la maille code postal, et ce n'est pas un oubli : le seul
   * référentiel de population par code postal surcompte de **10,5 %**
   * (74 876 618 contre 67 760 552), un carreau y étant compté dans chaque
   * contour qui le recouvre. Une colonne vide qui s'explique vaut mieux qu'un
   * pourcentage faux qui colore une carte.
   */
  pop_totale: number | null;
  /** Superficie de l'unité — le dénominateur de la densité. Mêmes limites. */
  surface_km2: number | null;
}

export interface Bandes {
  maille: string;
  cible: string;
  parent: string | null;
  region?: string | null;
  n_unites: number;
  tronquee: boolean;
  n_carreaux: number;
  /** Somme EXACTE de `par_classe` — l'arrondi a lieu au grain le plus fin. */
  total: number;
  par_classe: Record<string, number>;
  /**
   * Habitants de carreaux PROCHES d'un site que le profil ne retient pas.
   *
   * ⚠ Ce n'est PAS « la population non exposée de France » : le pré-calcul ne
   * contient que des carreaux à moins de 10 km d'un site à risque.
   */
  hors_zone: number;
  /**
   * Codes postaux TOUCHÉS — le grain auquel le DSP achète.
   *
   * ⚠ Invariant à la maille affichée, à dessein : « combien de codes postaux
   * vais-je acheter » ne doit pas changer de réponse selon la façon de
   * regarder le tableau. À ne pas confondre avec les codes postaux RETENUS,
   * qui dépendent du seuil de couverture et se décident à l'étape Zones.
   */
  n_codes_postaux: number;
  /**
   * Population du périmètre étudié, tirée du MÊME carroyage que le total.
   *
   * ⚠ Jamais les 67,76 millions de l'INSEE : trois départements d'outre-mer
   * n'ont aucun carreau, et le carroyage ne porte que les carreaux habités.
   */
  population_reference: number;
  /**
   * Population totale des unités touchées, avant troncature de la liste.
   *
   * Rapportée au total, elle dit ce qu'on achète pour ce qu'on vise.
   * `null` à la maille code postal, qui n'a pas de dénominateur fiable.
   */
  pop_unites_touchees: number | null;
  unites: UniteBandes[];
}

/** `'chargement' | 'echec' | 'pret'`, porté À CÔTÉ de la donnée. */
export type EtatChargement = 'chargement' | 'echec' | 'pret';

interface Resultat {
  etat: EtatChargement;
  bandes: Bandes | null;
  erreur: string | null;
  /** Le pré-calcul manque : ce n'est pas une panne, c'est une construction à faire. */
  aConstruire: boolean;
}

/** Délai d'apaisement après le dernier geste, en millisecondes. */
const DELAI_MS = 400;

/**
 * Charge la population par classe pour un profil et un périmètre.
 *
 * @param profil - Le profil normalisé.
 * @param cible - Le code de la cible comptée.
 * @param maille - `departement` ou `commune` ; toute autre valeur est refusée
 *   par la route, le pré-calcul ne portant que ces deux-là en colonne.
 * @param parent - Code de département pour descendre d'un cran, ou `null`.
 * @returns L'état de chargement, la réponse, et le message d'erreur éventuel.
 */
export function useBandes(
  profil: ProfilRayons,
  cible: string,
  maille: Dimension,
  parent: string | null,
  /**
   * Natures retenues. Vide = toutes.
   *
   * ⚠ Elles n'étaient PAS transmises jusqu'au 2026-09-20 : le filtre de la
   * barre commune changeait la courbe de l'onglet et pas ce tableau, sans que
   * rien le dise.
   */
  natures: string[] = [],
  /**
   * Code de RÉGION pour restreindre le calcul.
   *
   * ⚠ Distinct de `parent`, qui est un code de DÉPARTEMENT. Les deux
   * nomenclatures INSEE se recouvrent sur **18 codes** — `75` vaut Paris ET la
   * Nouvelle-Aquitaine — et les confondre a déjà coûté un drill-down qui
   * rendait 164 codes postaux au lieu de 21 (sql/171).
   */
  region: string | null = null,
): Resultat {
  const [r, setR] = useState<Resultat>({
    etat: 'chargement', bandes: null, erreur: null, aConstruire: false,
  });

  /*
   * Le jeton de la requête en cours. Un compteur plutôt qu'un `AbortController`
   * : annuler la requête réseau n'empêche pas une réponse déjà en vol d'être
   * traitée, et c'est bien l'ÉCRITURE qu'on veut ordonner, pas le transport.
   */
  const jeton = useRef(0);

  // Le profil est une valeur d'objet : le mettre en dépendance relancerait à
  // chaque rendu. Son code en est la forme canonique et comparable.
  const code = codeProfil(profil);
  // ⚠ La FORME SÉRIALISÉE des natures, jamais le tableau : recréé à chaque
  // rendu du parent, il relancerait l'appel indéfiniment.
  const cleNatures = natures.join(',');

  useEffect(() => {
    const mien = ++jeton.current;
    setR((p) => ({ ...p, etat: 'chargement' }));

    const minuteur = setTimeout(async () => {
      const p = new URLSearchParams({ profil: code, cible, maille });
      if (parent) p.set('parent', parent);
      if (region) p.set('region', region);
      if (cleNatures) p.set('natures', cleNatures);

      try {
        const rep = await adminFetch(`/api/risques/profil/bandes?${p}`);
        // La course : une réponse en retard ne doit pas écraser la courante.
        if (mien !== jeton.current) return;

        const corps = await rep.json();
        if (!rep.ok) {
          setR({
            etat: 'echec',
            bandes: null,
            erreur: corps?.error ?? 'Calcul des bandes indisponible.',
            aConstruire: corps?.a_construire === true,
          });
          return;
        }
        setR({ etat: 'pret', bandes: corps as Bandes, erreur: null, aConstruire: false });
      } catch {
        if (mien !== jeton.current) return;
        setR({
          etat: 'echec', bandes: null, aConstruire: false,
          erreur: 'Le calcul des bandes n’a pas répondu.',
        });
      }
    }, DELAI_MS);

    return () => clearTimeout(minuteur);
  }, [code, cible, maille, parent, region, cleNatures]);

  return r;
}
