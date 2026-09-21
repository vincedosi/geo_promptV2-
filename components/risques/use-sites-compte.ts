'use client';

/**
 * Combien de sites à risque les filtres retiennent, et sur combien au total.
 *
 * ── POURQUOI UN HOOK À PART DU RESTE ──────────────────────────────────────
 *
 * Ce comptage ne dépend PAS du profil de rayons. Le remonter avec les bandes
 * le ferait recalculer à chaque déplacement d'un anneau, alors que le nombre
 * de sites classés ne bouge pas quand on règle une distance.
 *
 * Il coûte deux lectures d'index — 1,4 ms mesuré — mais le principe vaut
 * quand même : un réglage ne relance que ce qu'il change.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export interface CompteSites {
  retenus: number;
  total: number;
  par_nature: Record<string, number>;
}

interface Resultat {
  compte: CompteSites | null;
  /** `true` tant que la première réponse n'est pas arrivée. */
  chargement: boolean;
}

/**
 * @param gravites - Gravités retenues (`seveso_haut`…). Vide = toutes.
 * @param natures - Libellés de natures retenus. Vide = toutes.
 * @param perimNiveau - `departement` ou `region`, ou `null` pour la France.
 * @param perimCode - Le code du territoire étudié.
 */
export function useSitesCompte(
  gravites: string[],
  natures: string[],
  perimNiveau: 'departement' | 'region' | null,
  perimCode: string | null,
): Resultat {
  const [r, setR] = useState<Resultat>({ compte: null, chargement: true });
  const jeton = useRef(0);

  // ⚠ Les formes SÉRIALISÉES : les tableaux sont recréés à chaque rendu du
  // parent et relanceraient l'appel indéfiniment.
  const cleGravites = gravites.join(',');
  const cleNatures = natures.join(',');

  useEffect(() => {
    const mien = ++jeton.current;
    /*
     * ⚠ Repasser en chargement à CHAQUE changement de filtre, et pas seulement
     * au premier montage.
     *
     * Sans cette ligne, `chargement` restait faux après la première réponse :
     * le compte précédent restait affiché pendant le nouvel appel, sans que
     * rien ne le signale, et la barre de progression mutualisée ne voyait
     * jamais cette source travailler. La donnée, elle, est conservée à
     * dessein — un écran qui se vide à chaque filtre clignote.
     */
    setR((p) => ({ ...p, chargement: true }));
    (async () => {
      const p = new URLSearchParams();
      if (cleGravites) p.set('gravites', cleGravites);
      if (cleNatures) p.set('natures', cleNatures);
      if (perimNiveau && perimCode) {
        p.set('perim_niveau', perimNiveau);
        p.set('perim_codes', perimCode);
      }
      try {
        const rep = await adminFetch(`/api/risques/sites/compter?${p}`);
        // Une réponse en retard ne doit pas écraser la courante.
        if (mien !== jeton.current) return;
        if (!rep.ok) { setR({ compte: null, chargement: false }); return; }
        setR({ compte: (await rep.json()) as CompteSites, chargement: false });
      } catch {
        if (mien !== jeton.current) return;
        setR({ compte: null, chargement: false });
      }
    })();
  }, [cleGravites, cleNatures, perimNiveau, perimCode]);

  return r;
}
