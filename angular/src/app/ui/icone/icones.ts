/**
 * Tracés des icônes de MAGELIAN.
 *
 * Copiés depuis `lucide-react` v1.7.0 (node_modules de la racine, lecture seule) :
 * chaque entrée reprend l'`__iconNode` du fichier `lucide-react/dist/esm/icons/<nom lucide>.js`,
 * sans les clés React. Le nom lucide est rappelé à droite de chaque entrée. Aucune dépendance :
 * `angular/` n'importe rien hors d'`angular/`.
 *
 * Pour ajouter une icône : lire `__iconNode` de `<nom lucide>.js`, ajouter une entrée ici (nom
 * français en kebab-case, éléments `path`/`circle`/`ellipse`/`rect`/`line`/`polyline`/`polygon`),
 * et la poser dans la planche de `/app/catalogue`. Le type `NomIcone` se met à jour tout seul.
 *
 * @license lucide ISC
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** Un élément SVG d'une icône : sa balise et ses attributs géométriques. */
export interface ElementIcone {
  readonly t: 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon';
  readonly d?: string;
  readonly cx?: string;
  readonly cy?: string;
  readonly r?: string;
  readonly rx?: string;
  readonly ry?: string;
  readonly x?: string;
  readonly y?: string;
  readonly width?: string;
  readonly height?: string;
  readonly x1?: string;
  readonly x2?: string;
  readonly y1?: string;
  readonly y2?: string;
  readonly points?: string;
}

export const ICONES = {
  'activite': [
    { t: 'path', d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' },
  ],   // lucide: activity
  'fleche-haut-droite': [
    { t: 'path', d: 'M7 7h10v10' },
    { t: 'path', d: 'M7 17 17 7' },
  ],   // lucide: arrow-up-right
  'base-de-donnees': [
    { t: 'ellipse', cx: '12', cy: '5', rx: '9', ry: '3' },
    { t: 'path', d: 'M3 5V19A9 3 0 0 0 21 19V5' },
    { t: 'path', d: 'M3 12A9 3 0 0 0 21 12' },
  ],   // lucide: database
  'fichier-haut': [
    { t: 'path', d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' },
    { t: 'path', d: 'M14 2v5a1 1 0 0 0 1 1h5' },
    { t: 'path', d: 'M12 12v6' },
    { t: 'path', d: 'm15 15-3-3-3 3' },
  ],   // lucide: file-up
  'calques': [
    { t: 'path', d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z' },
    { t: 'path', d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
    { t: 'path', d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
  ],   // lucide: layers
  'epingle-carte': [
    { t: 'path', d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' },
    { t: 'circle', cx: '12', cy: '10', r: '3' },
  ],   // lucide: map-pin
  'ecran': [
    { t: 'rect', width: '20', height: '14', x: '2', y: '3', rx: '2' },
    { t: 'line', x1: '8', x2: '16', y1: '21', y2: '21' },
    { t: 'line', x1: '12', x2: '12', y1: '17', y2: '21' },
  ],   // lucide: monitor
  'prise': [
    { t: 'path', d: 'M12 22v-5' },
    { t: 'path', d: 'M15 8V2' },
    { t: 'path', d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' },
    { t: 'path', d: 'M9 8V2' },
  ],   // lucide: plug
  'radio': [
    { t: 'path', d: 'M16.247 7.761a6 6 0 0 1 0 8.478' },
    { t: 'path', d: 'M19.075 4.933a10 10 0 0 1 0 14.134' },
    { t: 'path', d: 'M4.925 19.067a10 10 0 0 1 0-14.134' },
    { t: 'path', d: 'M7.753 16.239a6 6 0 0 1 0-8.478' },
    { t: 'circle', cx: '12', cy: '12', r: '2' },
  ],   // lucide: radio
  'bouclier-coche': [
    { t: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
    { t: 'path', d: 'm9 12 2 2 4-4' },
  ],   // lucide: shield-check
  'cible': [
    { t: 'circle', cx: '12', cy: '12', r: '10' },
    { t: 'circle', cx: '12', cy: '12', r: '6' },
    { t: 'circle', cx: '12', cy: '12', r: '2' },
  ],   // lucide: target
  'televerser': [
    { t: 'path', d: 'M12 3v12' },
    { t: 'path', d: 'm17 8-5-5-5 5' },
    { t: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
  ],   // lucide: upload
  'utilisateurs': [
    { t: 'path', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
    { t: 'path', d: 'M16 3.128a4 4 0 0 1 0 7.744' },
    { t: 'path', d: 'M22 21v-2a4 4 0 0 0-3-3.87' },
    { t: 'circle', cx: '9', cy: '7', r: '4' },
  ],   // lucide: users
  'menu': [
    { t: 'path', d: 'M4 5h16' },
    { t: 'path', d: 'M4 12h16' },
    { t: 'path', d: 'M4 19h16' },
  ],   // lucide: menu
  'oeil': [
    { t: 'path', d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' },
    { t: 'circle', cx: '12', cy: '12', r: '3' },
  ],   // lucide: eye
  'oeil-barre': [
    { t: 'path', d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' },
    { t: 'path', d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' },
    { t: 'path', d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' },
    { t: 'path', d: 'm2 2 20 20' },
  ],   // lucide: eye-off
  'cercle-alerte': [
    { t: 'circle', cx: '12', cy: '12', r: '10' },
    { t: 'line', x1: '12', x2: '12', y1: '8', y2: '12' },
    { t: 'line', x1: '12', x2: '12.01', y1: '16', y2: '16' },
  ],   // lucide: circle-alert
  'hexagone': [
    { t: 'path', d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' },
  ],   // lucide: hexagon
  'horloge': [
    { t: 'circle', cx: '12', cy: '12', r: '10' },
    { t: 'path', d: 'M12 6v6l4 2' },
  ],   // lucide: clock
  'courrier': [
    { t: 'path', d: 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7' },
    { t: 'rect', x: '2', y: '4', width: '20', height: '16', rx: '2' },
  ],   // lucide: mail
  'bouclier': [
    { t: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
  ],   // lucide: shield
  'soleil': [
    { t: 'circle', cx: '12', cy: '12', r: '4' },
    { t: 'path', d: 'M12 2v2' },
    { t: 'path', d: 'M12 20v2' },
    { t: 'path', d: 'm4.93 4.93 1.41 1.41' },
    { t: 'path', d: 'm17.66 17.66 1.41 1.41' },
    { t: 'path', d: 'M2 12h2' },
    { t: 'path', d: 'M20 12h2' },
    { t: 'path', d: 'm6.34 17.66-1.41 1.41' },
    { t: 'path', d: 'm19.07 4.93-1.41 1.41' },
  ],   // lucide: sun
  'lune': [
    { t: 'path', d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401' },
  ],   // lucide: moon
  'fermer': [
    { t: 'path', d: 'M18 6 6 18' },
    { t: 'path', d: 'm6 6 12 12' },
  ],   // lucide: x
} as const satisfies Record<string, readonly ElementIcone[]>;

/** Les noms d'icônes portés : un nom inconnu ne compile pas. */
export type NomIcone = keyof typeof ICONES;
