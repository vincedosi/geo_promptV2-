'use client';

/**
 * La barre de progression de l'écran de risque, et le marquage des chiffres
 * périmés.
 *
 * ── POURQUOI INDÉTERMINÉE ─────────────────────────────────────────────────
 *
 * Aucune des sources de cet écran ne rend d'avancement : ce sont des RPC
 * PostGIS qui répondent une fois, pas des flux à étapes. Afficher un
 * pourcentage supposerait de l'inventer — une barre qui avance à vitesse
 * constante pendant un calcul de 2,8 s puis attend, ou qui saute de 0 à 100.
 * Les deux mentent, et la seconde n'apprend rien.
 *
 * Le jour où une source streame (un import, une construction par bandes), le
 * composant prend un `pourcentage` et devient déterminé pour elle seule.
 *
 * ── LE TEXTE EST AUSSI IMPORTANT QUE LA BARRE ─────────────────────────────
 *
 * « Calcul de la population… » dit ce qu'on attend ; une barre nue dit
 * seulement qu'il faut attendre. Sur un écran où un geste coûte 2,8 s et un
 * autre 21 s, la différence décide si l'utilisateur patiente ou recharge.
 */
import React from 'react';
import { fInter } from '@/lib/design/polices';
import { useChargement } from '@/components/risques/ContexteChargement';

export function BarreProgression() {
  const { actif, texte } = useChargement();

  /*
   * ⚠ La barre reste MONTÉE en permanence, seule son opacité change.
   * Démonter et remonter un élément animé redémarre son animation à chaque
   * chargement, ce qui produit un sursaut à chaque changement de filtre — et
   * fait disparaître la hauteur de 3 px, donc décale tout l'écran d'autant.
   */
  return (
    <div
      role="progressbar"
      aria-busy={actif}
      aria-label={texte ?? 'Aucun calcul en cours'}
      style={{
        position: 'relative',
        height: 3,
        overflow: 'hidden',
        background: actif ? 'var(--bg-level-3)' : 'transparent',
        opacity: actif ? 1 : 0,
        transition: 'opacity 160ms linear',
      }}
    >
      {actif && (
        <>
          <span className="risque-barre-indeterminee" aria-hidden />
          <span
            style={{
              position: 'absolute', top: 6, left: 20,
              fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)',
              whiteSpace: 'nowrap', pointerEvents: 'none',
            }}
          >
            {texte}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Marque un bloc de chiffres comme PÉRIMÉ pendant un recalcul.
 *
 * ── CE QUE CE COMPOSANT EMPÊCHE ───────────────────────────────────────────
 *
 * Les hooks de l'écran conservent la donnée précédente pendant qu'ils
 * rechargent — c'est voulu, un écran qui se vide à chaque filtre clignote.
 * Mais ces chiffres restaient affichés **comme s'ils étaient valides** : rien
 * ne disait qu'ils décrivaient le filtre d'avant.
 *
 * ⚠ L'opacité, et NON un squelette : un squelette efface la valeur, donc
 * empêche de comparer l'avant et l'après — or comparer est exactement ce qu'on
 * fait en déplaçant un anneau. On garde le chiffre, on retire sa certitude.
 *
 * ⚠ `pointerEvents` reste actif : un panneau grisé n'est pas un panneau
 * désactivé. L'utilisateur doit pouvoir continuer à régler pendant un calcul,
 * sans quoi un calcul de 21 s bloque l'écran.
 *
 * ⚠ `style` est fourni par l'APPELANT, et ce n'est pas de la souplesse
 * gratuite : ce composant insère une boîte dans une disposition qu'il ne
 * connaît pas. `display: contents` l'éviterait — mais un élément sans boîte
 * ignore `opacity`, donc le marquage ne s'afficherait pas du tout. C'est donc
 * au parent, qui sait s'il est une colonne flex ou un bloc, de le dire.
 */
export function Perime(
  { actif, style, children }: {
    actif: boolean;
    style?: React.CSSProperties;
    children: React.ReactNode;
  },
) {
  return (
    <div
      aria-busy={actif}
      style={{
        opacity: actif ? 0.42 : 1,
        transition: 'opacity 160ms linear',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
