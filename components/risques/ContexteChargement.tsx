'use client';

/**
 * Le registre des chargements de l'écran de risque — un seul, pour tout.
 *
 * ── POURQUOI UN CONTEXTE ET PAS DES PROPS ─────────────────────────────────
 *
 * Les sources qui chargent ne sont pas au même endroit de l'arbre : les bandes
 * et la courbe vivent dans l'overlay, la préparation des zones dans la carte,
 * la construction d'un jeu dans le panneau ④. Faire remonter chacune par une
 * fonction de rappel obligerait chaque composant intermédiaire à transporter
 * un état qui ne le concerne pas — et le prochain panneau ajouté n'aurait
 * aucune raison de s'y brancher.
 *
 * Ici, une source déclare sa piste avec {@link usePiste} et n'a plus rien à
 * savoir : ni où la barre s'affiche, ni qui d'autre charge.
 *
 * ── LA CLÉ DOIT ÊTRE STABLE ───────────────────────────────────────────────
 *
 * Une piste s'enregistre sous sa clé et se remplace elle-même. Une clé
 * calculée à chaque rendu — l'identifiant d'un profil, par exemple — en
 * laisserait une par rendu, toutes actives, et la barre ne s'éteindrait
 * jamais.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { agregerChargement, type Chargement, type Piste } from '@/lib/risques/chargement';

interface Registre {
  declarer: (p: Piste) => void;
  retirer: (cle: string) => void;
  chargement: Chargement;
}

const Ctx = createContext<Registre | null>(null);

export function FournisseurChargement({ children }: { children: React.ReactNode }) {
  /*
   * Un tableau et non un `Map` : l'ORDRE de déclaration est l'ordre du
   * parcours, et c'est lui que `agregerChargement` restitue dans sa phrase.
   */
  const [pistes, setPistes] = useState<Piste[]>([]);

  const declarer = useCallback((p: Piste) => {
    setPistes((liste) => {
      const i = liste.findIndex((x) => x.cle === p.cle);
      // Rien à faire si l'état n'a pas bougé : sans cette garde, chaque rendu
      // d'un consommateur provoquerait un rendu du fournisseur, donc de tout
      // l'écran.
      if (i >= 0 && liste[i].actif === p.actif && liste[i].libelle === p.libelle) return liste;
      if (i < 0) return [...liste, p];
      const copie = [...liste];
      copie[i] = p;
      return copie;
    });
  }, []);

  const retirer = useCallback((cle: string) => {
    setPistes((liste) => (liste.some((x) => x.cle === cle) ? liste.filter((x) => x.cle !== cle) : liste));
  }, []);

  const chargement = useMemo(() => agregerChargement(pistes), [pistes]);
  const valeur = useMemo(() => ({ declarer, retirer, chargement }), [declarer, retirer, chargement]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

/**
 * Déclare une source de chargement.
 *
 * ⚠ Ne lève pas hors du fournisseur : un composant du module peut être monté
 * seul dans un test, et faire échouer le rendu pour une barre de progression
 * serait disproportionné. Sans fournisseur, la déclaration est simplement sans
 * effet.
 *
 * @param cle - Identifiant STABLE de la source.
 * @param libelle - La phrase lue pendant l'attente.
 * @param actif - La source charge-t-elle maintenant ?
 */
export function usePiste(cle: string, libelle: string, actif: boolean): void {
  const ctx = useContext(Ctx);
  const declarer = ctx?.declarer;
  const retirer = ctx?.retirer;

  useEffect(() => {
    if (!declarer) return;
    declarer({ cle, libelle, actif });
  }, [declarer, cle, libelle, actif]);

  // Au démontage seulement : une piste laissée derrière un panneau fermé
  // maintiendrait la barre allumée sans que rien ne puisse l'éteindre.
  useEffect(() => () => { retirer?.(cle); }, [retirer, cle]);
}

/** Le verdict global, pour la barre et pour le marquage des chiffres périmés. */
export function useChargement(): Chargement {
  return useContext(Ctx)?.chargement ?? { actif: false, libelles: [], texte: null };
}
