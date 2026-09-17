'use client';

/**
 * État de la couche « Zones à risque industriel ».
 *
 * Regroupé dans un hook plutôt qu'éparpillé en douze props : `PanneauCalques`
 * en reçoit déjà une soixantaine, et la couche a besoin du même état côté
 * `page.tsx`. Un seul objet voyage, comme `mapLayers` le fait déjà.
 *
 * ── Les deux défauts, et pourquoi ─────────────────────────────────────────
 *
 *  - `niveaux` = les deux niveaux Seveso. La base porte 99 152 installations
 *    classées mais seulement 1 327 Seveso ; ouvrir sur « tout » noierait les
 *    sites qui comptent sous 98 000 carrières, entrepôts et chaufferies — et
 *    99 152 points ne s'affichent pas.
 *  - `rayonM = 0`, donc pas de zone de danger au départ. La zone est une
 *    lecture en plus, pas le défaut : elle recouvre le fond de carte, et son
 *    rayon est un choix de l'utilisateur qu'on ne peut pas présumer.
 */
import { useMemo, useState } from 'react';
import type { FiltresRisque } from '../RisqueIndustrielLayer';

export interface EtatRisqueIndustriel {
  actif: boolean;
  setActif: (v: boolean) => void;
  niveaux: string[];
  setNiveaux: (v: string[]) => void;
  typesRisque: string[];
  setTypesRisque: (v: string[]) => void;
  inclureInactifs: boolean;
  setInclureInactifs: (v: boolean) => void;
  rayonM: number;
  setRayonM: (v: number) => void;
  afficherHalo: boolean;
  setAfficherHalo: (v: boolean) => void;
  compte: { rendus: number; total: number } | null;
  setCompte: (rendus: number, total: number) => void;
  /** Ce que la couche consomme, mémoïsé pour ne pas relancer l'effet à vide. */
  filtres: FiltresRisque;
}

export function useRisqueIndustriel(): EtatRisqueIndustriel {
  const [actif, setActif] = useState(false);
  const [niveaux, setNiveaux] = useState<string[]>(['seveso_haut', 'seveso_bas']);
  const [typesRisque, setTypesRisque] = useState<string[]>([]);
  const [inclureInactifs, setInclureInactifs] = useState(false);
  const [rayonM, setRayonM] = useState(0);
  const [afficherHalo, setAfficherHalo] = useState(true);
  const [compte, setCompteBrut] = useState<{ rendus: number; total: number } | null>(null);

  const filtres = useMemo<FiltresRisque>(
    () => ({ gravites: niveaux, typesRisque, inclureInactifs, rayonM, afficherHalo }),
    [niveaux, typesRisque, inclureInactifs, rayonM, afficherHalo],
  );

  return {
    actif, setActif,
    niveaux, setNiveaux,
    typesRisque, setTypesRisque,
    inclureInactifs, setInclureInactifs,
    rayonM, setRayonM,
    afficherHalo, setAfficherHalo,
    compte,
    setCompte: (rendus: number, total: number) => setCompteBrut({ rendus, total }),
    filtres,
  };
}
