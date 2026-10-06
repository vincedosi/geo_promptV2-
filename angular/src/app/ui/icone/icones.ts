/**
 * Tracés des icônes de MAGELIAN.
 *
 * Copiés depuis `lucide-react` v1.7.0 (node_modules de la racine, lecture seule) : chaque entrée
 * reprend l'`__iconNode` de `lucide-react/dist/esm/icons/<lucide>.js`, sans les clés React, et
 * nomme son fichier source dans le champ typé `lucide`. Aucune dépendance : `angular/` n'importe
 * rien hors d'`angular/`. Le test `tests/unit/angular/icones-lucide.test.ts` compare chaque entrée
 * au fichier lucide, attribut par attribut : toute dérive fait échouer la suite.
 *
 * | lucide-react (PascalCase)  | Nom Angular          |
 * |----------------------------|----------------------|
 * | Activity                   | activite             |
 * | ArrowUpRight               | fleche-haut-droite   | Feather (MIT)
 * | Database                   | base-de-donnees      | Feather (MIT)
 * | FileUp                     | fichier-haut         |
 * | Layers                     | calques              |
 * | MapPin                     | epingle-carte        |
 * | Monitor                    | ecran                | Feather (MIT)
 * | Plug                       | prise                |
 * | Radio                      | radio                | Feather (MIT)
 * | ShieldCheck                | bouclier-coche       |
 * | Target                     | cible                | Feather (MIT)
 * | Upload                     | televerser           | Feather (MIT)
 * | Users                      | utilisateurs         |
 * | Menu                       | menu                 |
 * | Eye                        | oeil                 |
 * | EyeOff                     | oeil-barre           |
 * | AlertCircle = CircleAlert  | cercle-alerte        | Feather (MIT)
 * | Hexagon                    | hexagone             |
 * | Clock                      | horloge              | Feather (MIT)
 * | Mail                       | courrier             |
 * | Shield                     | bouclier             |
 * | Sun                        | soleil               |
 * | Moon                       | lune                 | Feather (MIT)
 * | X                          | croix                | Feather (MIT)
 * | Download                   | telecharger          | Feather (MIT)
 * | Loader2 = LoaderCircle     | chargement           |
 * | Map                        | carte                |
 * | ChevronDown                | chevron-bas          | Feather (MIT)
 * | ChevronUp                  | chevron-haut         | Feather (MIT)
 * | ChevronLeft                | chevron-gauche       | Feather (MIT)
 * | ChevronRight               | chevron-droite       | Feather (MIT)
 * | Lock                       | cadenas              | Feather (MIT)
 * | Unlock = LockOpen          | cadenas-ouvert       |
 * | Maximize2                  | agrandir             |
 * | Minimize2                  | reduire              | Feather (MIT)
 * | Grid3x3                    | grille               |
 * | Plus                       | plus                 | Feather (MIT)
 * | Save                       | enregistrer          |
 * | Copy                       | copier               |
 * | Trash2                     | corbeille            | Feather (MIT)
 * | FolderOpen                 | dossier-ouvert       |
 * | PackageCheck               | colis-coche          |
 * | RefreshCw                  | rafraichir           |
 * | Play                       | jouer                |
 * | Sparkles                   | etincelles           |
 * | Megaphone                  | porte-voix           |
 * | Funnel                     | entonnoir            |
 * | FlaskConical               | fiole                |
 * | Shapes                     | formes               |
 * | Settings                   | reglages             |
 * | CircleHelp = CircleQuestionMark | aide            | Feather (MIT, « help-circle »)
 * | Info                       | info                 | Feather (MIT)
 * | Eraser                     | gomme                |
 * | Search                     | loupe                | Feather (MIT)
 *
 * Pour ajouter une icône : lire `__iconNode` de `<lucide>.js`, ajouter une entrée (nom français en
 * kebab-case ; `feather: true` si le nom figure dans la liste Feather de la LICENSE de lucide-react),
 * la poser dans la planche de `/app/catalogue` et relever le compte du test. `NomIcone` suit seul.
 *
 * ── Licences (LICENSE de lucide-react 1.7.0, reproduite telle quelle) ──────────────────────────
 *
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
 *
 * ---
 *
 * The following Lucide icons are derived from the Feather project:
 *
 * airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
 *
 * The MIT License (MIT) (for the icons listed above)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Hors reproduction : sous-ensemble Feather employé ici (`feather: true`) — alert-circle,
 * arrow-up-right, clock, database, download, help-circle, monitor, moon, radio, target, trash-2,
 * upload, x.
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

/** Une icône : son fichier lucide d'origine, son origine Feather éventuelle et ses éléments. */
export interface DefinitionIcone {
  readonly lucide: string;
  readonly feather?: true;
  readonly el: readonly ElementIcone[];
}

export const ICONES = {
  'activite': {
    lucide: 'activity',
    el: [
      { t: 'path', d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' },
    ],
  },
  'fleche-haut-droite': {
    lucide: 'arrow-up-right', feather: true,
    el: [
      { t: 'path', d: 'M7 7h10v10' },
      { t: 'path', d: 'M7 17 17 7' },
    ],
  },
  'base-de-donnees': {
    lucide: 'database', feather: true,
    el: [
      { t: 'ellipse', cx: '12', cy: '5', rx: '9', ry: '3' },
      { t: 'path', d: 'M3 5V19A9 3 0 0 0 21 19V5' },
      { t: 'path', d: 'M3 12A9 3 0 0 0 21 12' },
    ],
  },
  'fichier-haut': {
    lucide: 'file-up',
    el: [
      { t: 'path', d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' },
      { t: 'path', d: 'M14 2v5a1 1 0 0 0 1 1h5' },
      { t: 'path', d: 'M12 12v6' },
      { t: 'path', d: 'm15 15-3-3-3 3' },
    ],
  },
  'calques': {
    lucide: 'layers',
    el: [
      { t: 'path', d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z' },
      { t: 'path', d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
      { t: 'path', d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
    ],
  },
  'epingle-carte': {
    lucide: 'map-pin',
    el: [
      { t: 'path', d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' },
      { t: 'circle', cx: '12', cy: '10', r: '3' },
    ],
  },
  'ecran': {
    lucide: 'monitor', feather: true,
    el: [
      { t: 'rect', width: '20', height: '14', x: '2', y: '3', rx: '2' },
      { t: 'line', x1: '8', x2: '16', y1: '21', y2: '21' },
      { t: 'line', x1: '12', x2: '12', y1: '17', y2: '21' },
    ],
  },
  'prise': {
    lucide: 'plug',
    el: [
      { t: 'path', d: 'M12 22v-5' },
      { t: 'path', d: 'M15 8V2' },
      { t: 'path', d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' },
      { t: 'path', d: 'M9 8V2' },
    ],
  },
  'radio': {
    lucide: 'radio', feather: true,
    el: [
      { t: 'path', d: 'M16.247 7.761a6 6 0 0 1 0 8.478' },
      { t: 'path', d: 'M19.075 4.933a10 10 0 0 1 0 14.134' },
      { t: 'path', d: 'M4.925 19.067a10 10 0 0 1 0-14.134' },
      { t: 'path', d: 'M7.753 16.239a6 6 0 0 1 0-8.478' },
      { t: 'circle', cx: '12', cy: '12', r: '2' },
    ],
  },
  'bouclier-coche': {
    lucide: 'shield-check',
    el: [
      { t: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
      { t: 'path', d: 'm9 12 2 2 4-4' },
    ],
  },
  'cible': {
    lucide: 'target', feather: true,
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '10' },
      { t: 'circle', cx: '12', cy: '12', r: '6' },
      { t: 'circle', cx: '12', cy: '12', r: '2' },
    ],
  },
  'televerser': {
    lucide: 'upload', feather: true,
    el: [
      { t: 'path', d: 'M12 3v12' },
      { t: 'path', d: 'm17 8-5-5-5 5' },
      { t: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
    ],
  },
  'utilisateurs': {
    lucide: 'users',
    el: [
      { t: 'path', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
      { t: 'path', d: 'M16 3.128a4 4 0 0 1 0 7.744' },
      { t: 'path', d: 'M22 21v-2a4 4 0 0 0-3-3.87' },
      { t: 'circle', cx: '9', cy: '7', r: '4' },
    ],
  },
  'menu': {
    lucide: 'menu',
    el: [
      { t: 'path', d: 'M4 5h16' },
      { t: 'path', d: 'M4 12h16' },
      { t: 'path', d: 'M4 19h16' },
    ],
  },
  'oeil': {
    lucide: 'eye',
    el: [
      { t: 'path', d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' },
      { t: 'circle', cx: '12', cy: '12', r: '3' },
    ],
  },
  'oeil-barre': {
    lucide: 'eye-off',
    el: [
      { t: 'path', d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' },
      { t: 'path', d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' },
      { t: 'path', d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' },
      { t: 'path', d: 'm2 2 20 20' },
    ],
  },
  'cercle-alerte': {
    lucide: 'circle-alert', feather: true,
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '10' },
      { t: 'line', x1: '12', x2: '12', y1: '8', y2: '12' },
      { t: 'line', x1: '12', x2: '12.01', y1: '16', y2: '16' },
    ],
  },
  'hexagone': {
    lucide: 'hexagon',
    el: [
      { t: 'path', d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' },
    ],
  },
  'horloge': {
    lucide: 'clock', feather: true,
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '10' },
      { t: 'path', d: 'M12 6v6l4 2' },
    ],
  },
  'courrier': {
    lucide: 'mail',
    el: [
      { t: 'path', d: 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7' },
      { t: 'rect', x: '2', y: '4', width: '20', height: '16', rx: '2' },
    ],
  },
  'bouclier': {
    lucide: 'shield',
    el: [
      { t: 'path', d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
    ],
  },
  'soleil': {
    lucide: 'sun',
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '4' },
      { t: 'path', d: 'M12 2v2' },
      { t: 'path', d: 'M12 20v2' },
      { t: 'path', d: 'm4.93 4.93 1.41 1.41' },
      { t: 'path', d: 'm17.66 17.66 1.41 1.41' },
      { t: 'path', d: 'M2 12h2' },
      { t: 'path', d: 'M20 12h2' },
      { t: 'path', d: 'm6.34 17.66-1.41 1.41' },
      { t: 'path', d: 'm19.07 4.93-1.41 1.41' },
    ],
  },
  'lune': {
    lucide: 'moon', feather: true,
    el: [
      { t: 'path', d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401' },
    ],
  },
  'croix': {
    lucide: 'x', feather: true,
    el: [
      { t: 'path', d: 'M18 6 6 18' },
      { t: 'path', d: 'm6 6 12 12' },
    ],
  },
  'telecharger': {
    lucide: 'download', feather: true,
    el: [
      { t: 'path', d: 'M12 15V3' },
      { t: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
      { t: 'path', d: 'm7 10 5 5 5-5' },
    ],
  },
  'chargement': {
    lucide: 'loader-circle',
    el: [
      { t: 'path', d: 'M21 12a9 9 0 1 1-6.219-8.56' },
    ],
  },
  'carte': {
    lucide: 'map',
    el: [
      { t: 'path', d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z' },
      { t: 'path', d: 'M15 5.764v15' },
      { t: 'path', d: 'M9 3.236v15' },
    ],
  },
  'chevron-bas': {
    lucide: 'chevron-down', feather: true,
    el: [
      { t: 'path', d: 'm6 9 6 6 6-6' },
    ],
  },
  'chevron-haut': {
    lucide: 'chevron-up', feather: true,
    el: [
      { t: 'path', d: 'm18 15-6-6-6 6' },
    ],
  },
  'chevron-gauche': {
    lucide: 'chevron-left', feather: true,
    el: [
      { t: 'path', d: 'm15 18-6-6 6-6' },
    ],
  },
  'chevron-droite': {
    lucide: 'chevron-right', feather: true,
    el: [
      { t: 'path', d: 'm9 18 6-6-6-6' },
    ],
  },
  'cadenas': {
    lucide: 'lock', feather: true,
    el: [
      { t: 'rect', width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' },
      { t: 'path', d: 'M7 11V7a5 5 0 0 1 10 0v4' },
    ],
  },
  'cadenas-ouvert': {
    lucide: 'lock-open',
    el: [
      { t: 'rect', width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' },
      { t: 'path', d: 'M7 11V7a5 5 0 0 1 9.9-1' },
    ],
  },
  'agrandir': {
    lucide: 'maximize-2',
    el: [
      { t: 'path', d: 'M15 3h6v6' },
      { t: 'path', d: 'm21 3-7 7' },
      { t: 'path', d: 'm3 21 7-7' },
      { t: 'path', d: 'M9 21H3v-6' },
    ],
  },
  'grille': {
    lucide: 'grid-3x3',
    el: [
      { t: 'rect', width: '18', height: '18', x: '3', y: '3', rx: '2' },
      { t: 'path', d: 'M3 9h18' },
      { t: 'path', d: 'M3 15h18' },
      { t: 'path', d: 'M9 3v18' },
      { t: 'path', d: 'M15 3v18' },
    ],
  },
  'plus': {
    lucide: 'plus', feather: true,
    el: [
      { t: 'path', d: 'M5 12h14' },
      { t: 'path', d: 'M12 5v14' },
    ],
  },
  'reduire': {
    lucide: 'minimize-2', feather: true,
    el: [
      { t: 'path', d: 'm14 10 7-7' },
      { t: 'path', d: 'M20 10h-6V4' },
      { t: 'path', d: 'm3 21 7-7' },
      { t: 'path', d: 'M4 14h6v6' },
    ],
  },
  'enregistrer': {
    lucide: 'save',
    el: [
      { t: 'path', d: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' },
      { t: 'path', d: 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7' },
      { t: 'path', d: 'M7 3v4a1 1 0 0 0 1 1h7' },
    ],
  },
  'copier': {
    lucide: 'copy',
    el: [
      { t: 'rect', width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' },
      { t: 'path', d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' },
    ],
  },
  'corbeille': {
    lucide: 'trash-2', feather: true,
    el: [
      { t: 'path', d: 'M10 11v6' },
      { t: 'path', d: 'M14 11v6' },
      { t: 'path', d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' },
      { t: 'path', d: 'M3 6h18' },
      { t: 'path', d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' },
    ],
  },
  'dossier-ouvert': {
    lucide: 'folder-open',
    el: [
      { t: 'path', d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2' },
    ],
  },
  'colis-coche': {
    lucide: 'package-check',
    el: [
      { t: 'path', d: 'M12 22V12' },
      { t: 'path', d: 'm16 17 2 2 4-4' },
      { t: 'path', d: 'M21 11.127V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.32-.753' },
      { t: 'path', d: 'M3.29 7 12 12l8.71-5' },
      { t: 'path', d: 'm7.5 4.27 8.997 5.148' },
    ],
  },
  'rafraichir': {
    lucide: 'refresh-cw',
    el: [
      { t: 'path', d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' },
      { t: 'path', d: 'M21 3v5h-5' },
      { t: 'path', d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' },
      { t: 'path', d: 'M8 16H3v5' },
    ],
  },
  'jouer': {
    lucide: 'play',
    el: [
      { t: 'path', d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' },
    ],
  },
  'etincelles': {
    lucide: 'sparkles',
    el: [
      { t: 'path', d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z' },
      { t: 'path', d: 'M20 2v4' },
      { t: 'path', d: 'M22 4h-4' },
      { t: 'circle', cx: '4', cy: '20', r: '2' },
    ],
  },
  'porte-voix': {
    lucide: 'megaphone',
    el: [
      { t: 'path', d: 'M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
      { t: 'path', d: 'M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14' },
      { t: 'path', d: 'M8 6v8' },
    ],
  },
  'entonnoir': {
    lucide: 'funnel',
    el: [
      { t: 'path', d: 'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z' },
    ],
  },
  'fiole': {
    lucide: 'flask-conical',
    el: [
      { t: 'path', d: 'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2' },
      { t: 'path', d: 'M6.453 15h11.094' },
      { t: 'path', d: 'M8.5 2h7' },
    ],
  },
  'formes': {
    lucide: 'shapes',
    el: [
      { t: 'path', d: 'M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z' },
      { t: 'rect', x: '3', y: '14', width: '7', height: '7', rx: '1' },
      { t: 'circle', cx: '17.5', cy: '17.5', r: '3.5' },
    ],
  },
  'reglages': {
    lucide: 'settings',
    el: [
      { t: 'path', d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' },
      { t: 'circle', cx: '12', cy: '12', r: '3' },
    ],
  },
  'aide': {
    lucide: 'circle-question-mark', feather: true,
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '10' },
      { t: 'path', d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' },
      { t: 'path', d: 'M12 17h.01' },
    ],
  },
  'info': {
    lucide: 'info', feather: true,
    el: [
      { t: 'circle', cx: '12', cy: '12', r: '10' },
      { t: 'path', d: 'M12 16v-4' },
      { t: 'path', d: 'M12 8h.01' },
    ],
  },
  'gomme': {
    lucide: 'eraser',
    el: [
      { t: 'path', d: 'M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21' },
      { t: 'path', d: 'm5.082 11.09 8.828 8.828' },
    ],
  },
  'loupe': {
    lucide: 'search', feather: true,
    el: [
      { t: 'path', d: 'm21 21-4.34-4.34' },
      { t: 'circle', cx: '11', cy: '11', r: '8' },
    ],
  },
} as const satisfies Record<string, DefinitionIcone>;

/** Les noms d'icônes portés : un nom inconnu ne compile pas. */
export type NomIcone = keyof typeof ICONES;
