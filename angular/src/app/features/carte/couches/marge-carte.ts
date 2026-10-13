import { type EffectRef, effect, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';

/** La marge de la carte : seuls la gauche (panneau d'étape) et la droite (panneaux du bord droit) bougent. */
export interface MargeCarte { readonly top: 0; readonly bottom: 0; readonly left: number; readonly right: number }

/** Durée du recadrage qui suit un changement de marge survenu PENDANT un mouvement (voir `suivreMargeCarte`). */
export const DUREE_RECADRAGE_MARGE = 300;

/**
 * La marge de la CARTE (`setPadding` de MapLibre) suit ce qui la recouvre — relecture T4b, I-1. Le panneau d'étape
 * flotte au-dessus de la carte, ouvert par défaut à 480 px (T4b) : sans marge, MapLibre centre et cadre sur toute la
 * largeur, et la cible tombe sous le panneau (la France à l'ouverture, une zone affichée, un cluster, une bataille).
 *
 * Un seul point suffit pour le centrage initial ET les recadrages des services (zones custom, lien de zone, bataille,
 * zones à risque, clusters, POI, radio) : dans MapLibre 5.18 (`geo/projection/camera_helper.ts`,
 * `cameraForBoxAndBearing`), la largeur utile d'un `fitBounds` vaut `tr.width - (tr.padding.left + tr.padding.right +
 * padding.left + padding.right)` — la marge de la carte S'AJOUTE au `padding` de chaque appel, qui reste tel quel ; et
 * `flyTo`/`easeTo` centrent dans la partie non masquée. React n'en posait aucune : son panneau était fermé par défaut.
 *
 * ⚠ `setPadding` est un `jumpTo` : il ARRÊTE le mouvement en cours. Or « Afficher » une zone ouvre le plan média (marge
 * droite) dans le même tour que son `fitBounds` — la zone n'était jamais cadrée (constaté au navigateur, round 1). Une
 * marge qui change PENDANT un mouvement attend donc sa fin (`moveend`), puis recadre ce que la partie libre montrait
 * (ses coins dé-projetés) dans la nouvelle partie libre : la cible du mouvement reste cadrée, hors des panneaux.
 *
 * L'effet relit la carte courante : il se ré-applique à chaque carte publiée, donc après la recréation par changement
 * de fond (arbitrage B11). `gauche` et `droite` sont des lectures de signaux (largeur POSÉE du panneau, écart des outils) :
 * la marge ne change qu'au relâcher de la poignée, pas à chaque pixel du glissement. À créer dans un contexte d'injection.
 */
export function suivreMargeCarte(
  carte: () => maplibregl.Map | null,
  gauche: () => number,
  droite: () => number,
): EffectRef {
  let attente: { instance: maplibregl.Map; marge: MargeCarte } | null = null;
  return effect(() => {
    const instance = carte();
    const marge: MargeCarte = { top: 0, bottom: 0, left: gauche(), right: droite() };
    if (!instance) return;
    untracked(() => {
      if (!instance.isMoving()) {
        attente = null;
        instance.setPadding(marge);
        return;
      }
      const dejaEnAttente = attente?.instance === instance;
      attente = { instance, marge };
      if (!dejaEnAttente) instance.once('moveend', () => {
        const a = attente;
        attente = null;
        if (a && a.instance === instance) recadrer(instance, a.marge);
      });
    });
  });
}

/** Pose `marge` puis cadre dans la nouvelle partie libre ce que l'ancienne montrait. */
function recadrer(instance: maplibregl.Map, marge: MargeCarte): void {
  const ancienne = instance.getPadding();
  const conteneur = instance.getContainer();
  if (conteneur.clientWidth <= 0 || conteneur.clientHeight <= 0) {
    instance.setPadding(marge);
    return;
  }
  const { left = 0, top = 0, right = 0, bottom = 0 } = ancienne;
  const nordOuest = instance.unproject([left, top]);
  const sudEst = instance.unproject([conteneur.clientWidth - right, conteneur.clientHeight - bottom]);
  instance.setPadding(marge);
  instance.fitBounds([[nordOuest.lng, sudEst.lat], [sudEst.lng, nordOuest.lat]], { padding: 0, duration: DUREE_RECADRAGE_MARGE });
}
