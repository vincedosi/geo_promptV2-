'use client';

/**
 * L'état unique du module « Population à risque industriel ».
 *
 * ── CE QU'IL REMPLACE ─────────────────────────────────────────────────────
 *
 * Vingt `useState` indépendants dans `AnalysePopulationOverlay.tsx`, et rien
 * dans l'adresse de la page. Deux onglets qui portaient chacun sa copie des
 * mêmes filtres : changer de niveau réglementaire dans l'un ne changeait rien
 * dans l'autre, et les deux affichaient alors des chiffres différents pour la
 * même question sans que rien ne le signale.
 *
 * ── POURQUOI UN CONTEXTE ET PAS DES PROPS ─────────────────────────────────
 *
 * Les consommateurs sont à trois niveaux de profondeur (barre de filtres,
 * bandeau de KPI, trois onglets, panneau de profil, légende de la carte), et
 * la moitié d'entre eux n'ont besoin que d'un champ. Faire descendre neuf props
 * à travers quatre composants intermédiaires rend chaque ajout de filtre
 * coûteux — c'est ce qui a produit la divergence entre les deux onglets.
 *
 * ── LA SYNCHRONISATION D'URL, ET SON PIÈGE ────────────────────────────────
 *
 * On écrit avec `history.replaceState` et **jamais** `router.replace` : le
 * routeur de Next re-rend la page, ce qui démonte et remonte l'overlay à chaque
 * frappe dans un champ. `replaceState` change l'adresse sans toucher à l'arbre
 * React — c'est ce qui permet de refléter l'état en continu sans faire clignoter
 * l'écran.
 *
 * `replace` et non `push` : chaque cran de curseur n'a pas à créer une entrée
 * d'historique, sinon le bouton « retour » demande trente clics pour sortir.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ETAT_DEFAUT, ecrireEtatUrl, lireEtatUrl, type EtatRisque,
} from '@/lib/risques/etat-url';

interface ValeurContexte {
  etat: EtatRisque;
  /** Applique une modification partielle. Les champs absents ne bougent pas. */
  majEtat: (partiel: Partial<EtatRisque>) => void;
  /** Remet l'état d'ouverture, sans quitter le module. */
  reinitialiser: () => void;
}

const Contexte = createContext<ValeurContexte | null>(null);

/**
 * Le préfixe des paramètres du module dans l'URL.
 *
 * ⚠ `/map` porte déjà `?campaign=`, `?tab=` et `?overlay=`
 * (`components/magelian/deep-link.ts`). Écrire nos paramètres à plat
 * écraserait les leurs : un lien vers une campagne perdrait sa campagne en
 * ouvrant l'analyse de risque. On les range donc sous un paramètre unique.
 */
const PARAM = 'risque';

/** Lit l'état porté par l'URL courante, ou le défaut hors navigateur. */
function etatInitial(): EtatRisque {
  if (typeof window === 'undefined') return ETAT_DEFAUT;
  const brut = new URLSearchParams(window.location.search).get(PARAM);
  return lireEtatUrl(new URLSearchParams(brut ?? ''));
}

/**
 * Fournit l'état du module à tout son sous-arbre, et le reflète dans l'URL.
 *
 * @param children - L'écran du module.
 */
export function FournisseurRisque({ children }: { children: React.ReactNode }) {
  const [etat, setEtat] = useState<EtatRisque>(etatInitial);

  const majEtat = useCallback((partiel: Partial<EtatRisque>) => {
    setEtat((precedent) => ({ ...precedent, ...partiel }));
  }, []);

  const reinitialiser = useCallback(() => setEtat(ETAT_DEFAUT), []);

  /**
   * Le dernier état écrit dans l'URL.
   *
   * ⚠ Sans cette garde, l'effet réécrit l'adresse à CHAQUE rendu, y compris
   * ceux provoqués par un chargement de données. Sur Chrome, plus de cent
   * `replaceState` en trente secondes déclenchent une limitation silencieuse et
   * les suivants sont ignorés : l'URL se fige alors sur un état ancien, ce qui
   * se lit comme une perte de réglages.
   */
  const dernier = useRef<string | null>(null);

  useEffect(() => {
    const encode = ecrireEtatUrl(etat);
    if (dernier.current === encode) return;
    dernier.current = encode;

    const params = new URLSearchParams(window.location.search);
    if (encode === '') params.delete(PARAM);
    else params.set(PARAM, encode);

    const requete = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${requete ? `?${requete}` : ''}`,
    );
  }, [etat]);

  const valeur = useMemo<ValeurContexte>(
    () => ({ etat, majEtat, reinitialiser }),
    [etat, majEtat, reinitialiser],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * L'état du module et son modificateur.
 *
 * @throws {Error} Hors du fournisseur — un état silencieusement par défaut
 *   donnerait un écran qui fonctionne mais ignore tous les filtres, ce qui est
 *   bien plus difficile à diagnostiquer qu'une erreur au montage.
 */
export function useEtatRisque(): ValeurContexte {
  const v = useContext(Contexte);
  if (!v) throw new Error('useEtatRisque doit être appelé dans <FournisseurRisque>.');
  return v;
}
