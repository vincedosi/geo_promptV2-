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
 *
 * ── LE PPRT EST DANS LE MÊME ÉTAT, ET C'EST VOULU ─────────────────────────
 *
 * Le périmètre PPRT (`pprtActif`) est une COUCHE distincte — une servitude
 * opposable, pas un rayon de notre invention — mais elle vit dans la même
 * section du panneau, parce que c'est là que l'utilisateur les compare. Un
 * second hook aurait fait voyager deux objets pour une seule section.
 *
 * `pprtActif = false` au départ : la couche a un plancher de zoom (8), donc
 * l'activer par défaut afficherait une case cochée qui ne produit rien tant
 * qu'on n'a pas zoomé — exactement le défaut qui rendait la couche IRIS muette.
 */
import { useMemo, useState } from 'react';
import type { FiltresRisque } from '../RisqueIndustrielLayer';
import type { EtatCouchePprt } from '../PprtLayer';

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
  /**
   * `avecPprt` compte, parmi les sites RENDUS, ceux qui ont un vrai perimetre
   * PPRT (sql/179). Il voyage avec le compte plutot que d'etre re-derive dans
   * la legende : deux calculs du meme chiffre finiraient par en donner deux.
   */
  compte: { rendus: number; total: number; avecPprt: number } | null;
  setCompte: (rendus: number, total: number, avecPprt: number) => void;

  /** Couche « Périmètre PPRT » (servitudes PM3), distincte du rayon calculé. */
  pprtActif: boolean;
  setPprtActif: (v: boolean) => void;
  /** Familles de `type_zone` retenues. Vide = toutes. */
  pprtTypes: string[];
  setPprtTypes: (v: string[]) => void;
  pprtEtat: EtatCouchePprt | null;
  setPprtEtat: (e: EtatCouchePprt) => void;
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
  const [compte, setCompteBrut] = useState<{ rendus: number; total: number; avecPprt: number } | null>(null);
  const [pprtActif, setPprtActif] = useState(false);
  const [pprtTypes, setPprtTypes] = useState<string[]>([]);
  const [pprtEtat, setPprtEtat] = useState<EtatCouchePprt | null>(null);

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
    setCompte: (rendus: number, total: number, avecPprt: number) =>
      setCompteBrut({ rendus, total, avecPprt }),
    pprtActif, setPprtActif,
    pprtTypes, setPprtTypes,
    pprtEtat, setPprtEtat,
    filtres,
  };
}
