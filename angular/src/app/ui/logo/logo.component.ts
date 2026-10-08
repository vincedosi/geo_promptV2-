import { ChangeDetectionStrategy, Component, computed, isDevMode, input } from '@angular/core';

/**
 * Le logo dentsu, en SVG EN LIGNE.
 *
 * Tracés recopiés tels quels de `public/dentsu-logo.svg` (racine du dépôt), le
 * fichier officiel monochrome noir — `tests/unit/design/logo-dentsu.test.ts`
 * vérifie qu'ils n'en divergent pas, ici comme dans la copie React
 * (`components/ui/LogoDentsu.tsx`).
 *
 * En ligne plutôt qu'en `<img>` : dans le shell AIDA, une adresse relative se
 * résout contre le DOCUMENT du shell, pas contre notre application ; et le
 * fichier est noir, invisible sur fond sombre. Ici le remplissage est
 * `currentColor` et l'hôte porte `text-primary` : noir en thème clair, blanc en
 * thème sombre. Aucun hex, aucun filtre.
 *
 * Taille : `[hauteur]` OU `[largeur]`, en pixels ; l'autre côté suit le
 * rapport du fichier (3840 × 812). Sans l'un ni l'autre, la taille se règle sur
 * l'hôte (`class="h-5"`).
 */
@Component({
  selector: 'mg-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'text-primary',
    // Bloc dès qu'on fixe la largeur : en ligne, le blanc de ligne sous la base
    // ajoutait ~6 px de haut.
    '[class.block]': 'largeur() !== undefined',
    '[class.inline-block]': 'largeur() === undefined',
    '[style.height.px]': 'hauteur() ?? null',
    '[style.width.px]': 'largeur() ?? null',
  },
  template: `
    <svg [class]="classeSvg()" viewBox="0 0 3840 812" role="img" aria-label="dentsu.explore"
         xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0,812) scale(0.1,-0.1)" fill="currentColor" stroke="none">
        <path data-lettre="d" d="M4110 7465 c0 -523 -3 -655 -13 -655 -66 0 -1147 -73 -1253 -85 -1246 -137 -1954 -615 -2452 -1655 -223 -467 -246 -627 -246 -1700 0 -1050 20 -1176 262 -1683 425 -888 1034 -1383 1875 -1521 288 -48 495 -55 867 -31 666 42 1297 72 1832 85 233 5 527 13 655 16 l232 6 5 52 c6 67 45 6231 46 7344 l0 482 -905 0 -905 0 0 -655z m-1 -3517 c-6 -1408 -10 -1560 -45 -1778 -48 -303 -146 -421 -387 -468 -122 -23 -732 -23 -872 0 -601 101 -886 440 -990 1178 -22 154 -32 688 -16 871 50 579 224 951 564 1205 348 259 838 374 1682 392 l70 2 -6 -1402z" />
        <path data-lettre="t" d="M21285 7848 c3 -150 10 -687 15 -1193 45 -4109 70 -4795 200 -5301 93 -362 333 -726 590 -896 273 -180 625 -294 1085 -348 150 -18 554 -24 735 -11 324 24 490 50 943 148 l268 58 -3 725 c-4 628 -6 732 -20 779 -26 88 -57 97 -197 61 -225 -57 -926 -140 -1186 -140 -409 1 -519 143 -576 745 -8 80 -13 566 -16 1458 l-4 1337 53 0 c29 0 460 -16 958 -35 498 -19 924 -35 948 -35 l42 0 0 790 0 790 -1000 0 -1000 0 0 670 0 670 -921 0 -920 0 6 -272z" />
        <path data-lettre="e" d="M9945 6923 c-812 -49 -1520 -359 -2036 -889 -253 -262 -445 -548 -625 -934 -168 -362 -213 -515 -245 -830 -16 -164 -23 -1146 -10 -1439 16 -360 41 -514 118 -721 47 -126 195 -428 278 -565 496 -820 1265 -1281 2335 -1400 408 -45 972 -35 1480 26 285 34 536 83 775 152 98 29 821 289 830 299 5 6 56 1553 53 1605 l-3 52 -300 -133 c-327 -145 -526 -222 -735 -285 -847 -253 -1670 -288 -2176 -92 -129 50 -252 138 -400 285 -247 247 -388 479 -465 760 -17 61 -33 119 -35 129 -5 16 100 17 2116 17 l2122 0 -6 78 c-4 42 -20 302 -36 577 -17 275 -35 554 -41 620 -47 558 -137 940 -299 1270 -115 235 -252 424 -458 634 -331 335 -759 567 -1284 695 -300 73 -661 107 -953 89z m260 -1498 c184 -39 461 -159 585 -253 230 -176 378 -403 383 -588 3 -104 -41 -139 -204 -164 -194 -29 -1556 -29 -1804 0 -256 30 -323 96 -247 246 31 61 143 212 230 309 221 248 599 428 972 463 8 1 46 -5 85 -13z" />
        <path data-lettre="n" d="M17092 6870 c-164 -10 -253 -25 -304 -51 -110 -56 -712 -72 -1748 -44 -300 8 -582 15 -627 15 l-83 0 0 -3300 0 -3300 860 0 860 0 0 2443 0 2442 206 88 c339 144 461 171 769 170 288 -1 486 -40 681 -134 153 -75 272 -196 313 -321 79 -240 89 -509 126 -3527 8 -640 16 -1165 17 -1167 2 -1 192 4 423 12 231 7 566 18 745 24 179 5 385 13 458 16 l132 6 0 1472 c-1 1549 -12 2710 -30 3011 -27 459 -74 687 -191 934 -199 420 -594 827 -994 1021 -172 84 -322 123 -595 154 -300 34 -777 51 -1018 36z" />
        <path data-lettre="s" d="M28890 6874 c-293 -21 -595 -65 -805 -119 -680 -174 -1239 -619 -1530 -1220 -309 -637 -263 -1340 121 -1851 201 -268 561 -531 928 -678 222 -90 475 -161 1016 -285 513 -118 802 -206 1005 -306 119 -59 212 -131 239 -189 22 -48 20 -118 -5 -169 -30 -59 -143 -166 -214 -203 -283 -148 -866 -164 -1583 -43 -473 79 -854 187 -1350 383 -134 53 -246 96 -249 96 -3 0 -3 -282 0 -627 5 -646 13 -777 52 -926 33 -128 66 -161 248 -247 358 -170 1093 -333 1720 -381 197 -15 697 -6 892 15 1375 153 2133 781 2271 1881 32 255 18 618 -32 833 -139 599 -563 993 -1362 1266 -198 68 -416 126 -824 220 -678 158 -957 233 -1070 292 -50 26 -118 95 -145 147 -84 168 4 345 210 422 358 133 1284 69 2157 -150 210 -53 465 -129 614 -184 60 -23 117 -41 128 -41 69 0 86 59 99 350 18 372 0 845 -41 1047 -27 136 -48 168 -145 220 -142 75 -505 213 -774 292 -194 58 -460 106 -746 137 -133 14 -701 27 -825 18z" />
        <path data-lettre="u" d="M36677 4688 c-4 -2129 -6 -2232 -42 -2483 -39 -264 -103 -396 -228 -469 -86 -51 -190 -67 -592 -91 -416 -25 -551 -17 -680 44 -91 42 -137 76 -331 242 l-172 148 -6 93 c-3 51 -24 1022 -46 2158 -22 1136 -43 2142 -46 2236 l-6 170 -580 19 c-572 18 -877 16 -982 -5 -74 -15 -134 -48 -152 -83 -30 -57 -37 -307 -37 -1312 0 -1299 23 -2636 54 -3115 30 -475 68 -645 214 -947 92 -191 164 -314 258 -439 322 -430 718 -639 1407 -745 99 -15 204 -22 395 -26 275 -6 427 3 625 37 330 56 823 75 1736 66 397 -3 769 -9 828 -13 l106 -6 0 3306 0 3307 -859 0 -860 0 -4 -2092z" />
      </g>
    </svg>
  `,
})
export class LogoComponent {
  /** Hauteur en pixels (largeur automatique). */
  readonly hauteur = input<number>();
  /** Largeur en pixels (hauteur automatique). */
  readonly largeur = input<number>();

  protected readonly classeSvg = computed(() => {
    if (isDevMode() && this.hauteur() !== undefined && this.largeur() !== undefined) {
      throw new Error('mg-logo : hauteur et largeur sont exclusives (le rapport du viewBox serait faussé).');
    }
    return this.largeur() !== undefined ? 'block w-full h-auto' : 'block h-full w-auto';
  });
}
