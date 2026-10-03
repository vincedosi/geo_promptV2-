/**
 * Zooms des zones de risque — copie Angular de `lib/version.ts:86-137`.
 * Trois seuils distincts, déclarés UNE fois : la source de tuiles, les `minzoom`
 * des couches et la bascule fondu/détail les lisent ici.
 */

/**
 * Zoom minimal des tuiles de ZONES DE RISQUE (`/api/tiles/zones-risque/...`).
 *
 * ⚠ Il est bien plus bas que `PPRT_ZOOM_PLANCHER`, et ce n'est pas une
 * incohérence : les deux couches n'ont pas la même taille. Un périmètre PPRT
 * fait 0,94 km de large en moyenne et 2 m au minimum — invisible sous z8. Une
 * zone de risque est l'union de tampons de 1 à 5 km, parfaitement lisible à
 * l'échelle de la France.
 *
 * Poids mesuré le 2026-09-19, profil par défaut, tuile BRUTE avant gzip :
 *   z4  43 ko (la France entière tient dedans)   z7   5,0 ko
 *   z5  41 ko                                    z8   2,8 ko
 *   z6  31 ko                                    z10   943 o
 *
 * La simplification est dérivée de la taille du PIXEL au zoom demandé, d'où la
 * décroissance : plus on dézoome, plus on simplifie, et le poids reste borné.
 *
 * ⚠ Ce que le plancher ne règle pas : une bande intérieure de 500 m mesure
 * moins d'un pixel sous z9. Elle est présente dans la tuile — c'est pour cela
 * que sql/205 emploie `ST_SimplifyPreserveTopology` et jamais `ST_Simplify`,
 * qui la VIDERAIT — mais l'œil ne la distingue pas. C'est à la légende de le
 * dire, pas au plancher de la masquer.
 */
export const ZONES_RISQUE_ZOOM_PLANCHER = 4;

/**
 * Le zoom à partir duquel les zones sont RENDUES.
 *
 * ⚠ À ne pas confondre avec `ZONES_RISQUE_ZOOM_PLANCHER` juste au-dessus, qui
 * dit à partir de quand les tuiles EXISTENT. Entre les deux — z4 à z7 — les
 * tuiles sont servies et les zones peintes en taches de moins d'un pixel :
 * présentes, illisibles, et sans que rien ne le dise. Le bandeau de la carte
 * se déclenche sur CELUI-CI, pas sur le plancher, sinon il n'apparaîtrait
 * qu'au-dessous de z4, c'est-à-dire jamais en usage réel.
 *
 * Les couches portent donc ce `minzoom` pendant que la source garde le
 * plancher : séparer les deux permet de dire « zoomez » sans cesser de
 * préparer les tuiles.
 */
export const ZONES_RISQUE_ZOOM_LISIBLE = 7;

/**
 * Le zoom à partir duquel on montre le DÉTAIL par classe.
 *
 * En dessous, les bandes d'un même niveau sont fondues en un seul aplat : à
 * z8, un anneau de 500 m fait deux pixels et quatre opacités dégressives ne se
 * distinguent plus — elles donnent un bord sale, pas une information. On lit
 * alors « où sont les zones du seuil haut », ce qui est la question de cette
 * échelle. Au-dessus, chaque bande reprend son opacité et son contour, et
 * porte l'étiquette de son rayon.
 */
export const ZONES_RISQUE_ZOOM_DETAIL = 10;
