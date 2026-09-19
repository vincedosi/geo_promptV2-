/**
 * Briques de balisage des popups MapLibre.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 *
 * `lignePopup` vivait en copie locale dans `RisqueIndustrielLayer.tsx`, et la
 * couche PPRT en avait besoin à l'identique. Deux copies d'un rendu HTML
 * **échappé** est précisément le défaut qui produit un XSS : l'une est
 * corrigée, l'autre reste. Le projet a déjà payé ce risque une fois sur les
 * popups de carreaux — d'où `lib/map/echapper-html.ts`, dont ce fichier est le
 * pendant côté balisage.
 *
 * Les couleurs passent par `var(--token)` et non par des littéraux : ces
 * chaînes atterrissent dans le DOM, où `var()` se résout — contrairement au
 * `paint` de MapLibre, qui exige les valeurs en dur.
 */
import { echapperHtml } from '@/lib/map/echapper-html';

/**
 * Une ligne « intitulé : valeur » d'une popup, ou la chaîne VIDE si la valeur
 * est absente.
 *
 * C'est ce retour vide qui permet d'enchaîner les lignes sans tester chaque
 * champ : une popup ne doit jamais afficher « Adresse : — ». Un champ absent
 * disparaît, il ne se signale pas.
 */
export function lignePopup(intitule: string, valeur: unknown): string {
  const v = valeur === null || valeur === undefined ? '' : String(valeur).trim();
  if (!v) return '';
  return (
    `<div style="display:flex;gap:8px;margin-top:3px">` +
    `<span style="color:var(--text-tertiary);flex:0 0 96px">${echapperHtml(intitule)}</span>` +
    `<span style="color:var(--text-secondary)">${echapperHtml(v)}</span></div>`
  );
}

/** Titre d'une popup. Inter 500, 12 px, encre primaire — cf. DESIGN_SYSTEM. */
export function titrePopup(texte: unknown): string {
  return (
    `<div style="font-size:12px;font-weight:500;color:var(--text-primary)">` +
    `${echapperHtml(String(texte ?? '').trim() || 'Sans nom')}</div>`
  );
}

/** Enveloppe d'une popup : police, taille, largeur maximale, marge interne. */
export function cadrePopup(contenu: string, largeurMax = 320): string {
  return (
    `<div style="font-family:Inter,system-ui,sans-serif;font-size:11px;` +
    `max-width:${largeurMax}px;padding:8px 10px">${contenu}</div>`
  );
}
