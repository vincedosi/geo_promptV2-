'use client';

/**
 * Chargement de la courbe de couverture par rayon.
 *
 * ── POURQUOI UN HOOK, ET POURQUOI IL VIT DANS L'OVERLAY ───────────────────
 *
 * L'appel vivait dans `OngletRayonInfluence`, monté sous l'onglet Rayons. Il
 * repartait donc à CHAQUE retour sur cet onglet — mesuré le 2026-09-20 :
 * quatre appels pour cinq bascules, sans qu'aucun réglage ait bougé. La courbe
 * disparaissait puis revenait, identique.
 *
 * Hissé dans l'overlay, il survit au changement d'onglet : basculer devient
 * instantané. Même geste que `use-bandes.ts`, pour la même raison.
 *
 * ── LES DÉPENDANCES SONT DES CHAÎNES, PAS DES TABLEAUX ───────────────────
 *
 * `niveaux`, `natures` et `perim` sont recréés à chaque rendu du parent. Mis
 * tels quels en dépendance d'un `useCallback`, ils relancent l'appel à chaque
 * rendu — une boucle qui ne s'arrête jamais et sature le quota. On dépend donc
 * de leur FORME SÉRIALISÉE, qui ne change que quand leur contenu change.
 *
 * ── LA COURSE ─────────────────────────────────────────────────────────────
 *
 * Deux filtres changés coup sur coup peuvent revenir dans le désordre : le
 * second porte sur moins de sites et double le premier. L'écran afficherait
 * alors une courbe que plus personne ne regarde, sans rien pour le signaler.
 * Chaque requête porte un jeton, seule la dernière a le droit d'écrire.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

/**
 * La forme EXACTE que rend `/api/risques/exposition/rayon`.
 *
 * Déclarée ici et importée par l'écran, jamais recopiée : deux déclarations
 * d'un même payload finissent par diverger, et c'est l'écran qui lit alors un
 * champ que le serveur n'envoie plus.
 */
export interface PointCourbe { r: number; p: number; i: number }

export interface Courbe {
  cle: string;
  total: number;
  carreaux: number;
  points: PointCourbe[];
}

export interface ReponseCourbe {
  cible: string;
  gravite: string;
  rayon_max_m: number;
  total_est_global: boolean;
  n_departements: number;
  n_sites: number;
  /** Part de la MÉTROPOLE dont le pré-calcul est fait. 100 = complet (sql/201). */
  couverture_pct: number;
  n_bandes_construites: number;
  /** Zones d'outre-mer pré-calculées (Martinique, La Réunion) — 2 au plus. */
  n_zones_lointaines: number;
  courbes: Courbe[];
  calcule_le: string;
}

export interface ResultatCourbe {
  data: ReponseCourbe | null;
  chargement: boolean;
  erreur: string | null;
  /** Le pré-calcul manque : ce n'est pas une panne, c'est une construction. */
  aConstruire: boolean;
}

/** Le périmètre courant, sous la forme que la route attend. */
export interface PerimetreCourbe {
  niveau: 'region' | 'departement';
  code: string;
}

/**
 * Charge la courbe de couverture.
 *
 * @param cible - Code de la cible comptée.
 * @param niveaux - Gravités retenues. Vide = toutes.
 * @param natures - Natures de risque retenues. Vide = toutes.
 * @param perim - Territoire courant, ou `null` pour la France entière.
 */
export function useCourbeRayon(
  cible: string,
  niveaux: string[],
  natures: string[],
  perim: PerimetreCourbe | null,
): ResultatCourbe {
  const [data, setData] = useState<ReponseCourbe | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aConstruire, setAConstruire] = useState(false);

  const dernier = useRef(0);

  // Les formes sérialisées : elles ne changent que quand le contenu change.
  const cleNiveaux = niveaux.join(',');
  const cleNatures = natures.join(',');
  const clePerim = perim ? `${perim.niveau}:${perim.code}` : '';

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    setAConstruire(false);
    const jeton = ++dernier.current;
    try {
      const p = new URLSearchParams({ cible });
      if (cleNiveaux) p.set('gravites', cleNiveaux);
      if (cleNatures) p.set('natures', cleNatures);
      if (clePerim) {
        const [niveau, code] = clePerim.split(':');
        p.set('perim_niveau', niveau);
        p.set('perim_codes', code);
      }
      const r = await adminFetch(`/api/risques/exposition/rayon?${p}`);
      const j = await r.json();
      if (jeton !== dernier.current) return;
      if (!r.ok) {
        setErreur(typeof j?.error === 'string' ? j.error : 'Courbe indisponible.');
        setAConstruire(Boolean(j?.a_construire));
        setData(null);
        return;
      }
      setData(j as ReponseCourbe);
    } catch {
      if (jeton === dernier.current) { setErreur('Courbe indisponible.'); setData(null); }
    } finally {
      if (jeton === dernier.current) setChargement(false);
    }
  }, [cible, cleNiveaux, cleNatures, clePerim]);

  useEffect(() => { void charger(); }, [charger]);

  return { data, chargement, erreur, aConstruire };
}
