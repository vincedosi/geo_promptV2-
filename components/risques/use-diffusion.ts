'use client';

/**
 * Chargement de la confrontation diffusion × classes de risque.
 *
 * Même forme que `use-bandes.ts`, et pour les mêmes raisons : délai
 * d'apaisement contre la rafale de gestes du réglage de profil, et jeton de
 * course pour qu'une réponse en retard n'écrase pas la courante — deux profils
 * lancés coup sur coup peuvent revenir dans le désordre, et l'écran afficherait
 * alors les chiffres d'un profil que plus personne ne regarde.
 *
 * ⚠ Les deux hooks ne sont PAS fusionnés malgré leur ressemblance : ils
 * appellent deux routes, l'une n'a pas besoin de campagne, et les fondre
 * imposerait un paramètre inutile à l'un des deux appelants — puis, à la
 * première divergence, une branche conditionnelle dans le corps.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { codeProfil } from '@/lib/risques/code-profil';
import type { ProfilRayons } from '@/lib/risques/profil';
import type { Dimension } from '@/lib/risques/dimensions';

export interface ClasseDiffusion {
  classe: string;
  population: number;
  impressions: number;
  depense: number;
  /** Part des impressions / part de population × 100. `null` si incalculable. */
  indice: number | null;
}

export interface Diffusion {
  campagne: string;
  /** `dsp_campaigns.is_demo` — porte le badge « Données de démonstration ». */
  est_demo: boolean;
  cible: string;
  maille: string;
  parent: string | null;
  impressions_totales: number;
  impressions_en_zone: number;
  population_touchee: number;
  classes: ClasseDiffusion[];
}

interface Resultat {
  etat: 'chargement' | 'echec' | 'pret';
  diffusion: Diffusion | null;
  erreur: string | null;
  /** La campagne n'a aucune impression : ce n'est pas une panne. */
  sansDonnees: boolean;
}

const DELAI_MS = 400;

/**
 * Charge la ventilation des impressions d'une campagne par classe de risque.
 *
 * @param campagne - L'identifiant de campagne, ou `null` (rien n'est demandé).
 * @param profil - Le profil normalisé.
 * @param cible - Le code de la cible comptée.
 * @param maille - `departement` ou `commune`.
 * @param parent - Code de département pour descendre d'un cran, ou `null`.
 */
export function useDiffusion(
  campagne: string | null,
  profil: ProfilRayons,
  cible: string,
  maille: Dimension,
  parent: string | null,
): Resultat {
  const [r, setR] = useState<Resultat>({
    etat: 'chargement', diffusion: null, erreur: null, sansDonnees: false,
  });

  const jeton = useRef(0);
  const code = codeProfil(profil);
  const mailleUtile: Dimension = maille === 'commune' ? 'commune' : 'departement';

  useEffect(() => {
    if (!campagne) {
      setR({ etat: 'pret', diffusion: null, erreur: null, sansDonnees: false });
      return;
    }

    const mien = ++jeton.current;
    setR((p) => ({ ...p, etat: 'chargement' }));

    const minuteur = setTimeout(async () => {
      const p = new URLSearchParams({ campagne, profil: code, cible, maille: mailleUtile });
      if (parent) p.set('parent', parent);

      try {
        const rep = await adminFetch(`/api/risques/diffusion?${p}`);
        if (mien !== jeton.current) return;

        const corps = await rep.json();
        if (!rep.ok) {
          setR({
            etat: 'echec',
            diffusion: null,
            erreur: corps?.error ?? 'Diffusion indisponible.',
            sansDonnees: corps?.sans_donnees === true,
          });
          return;
        }
        setR({ etat: 'pret', diffusion: corps as Diffusion, erreur: null, sansDonnees: false });
      } catch {
        if (mien !== jeton.current) return;
        setR({
          etat: 'echec', diffusion: null, sansDonnees: false,
          erreur: 'La ventilation n’a pas répondu.',
        });
      }
    }, DELAI_MS);

    return () => clearTimeout(minuteur);
  }, [campagne, code, cible, mailleUtile, parent]);

  return r;
}
