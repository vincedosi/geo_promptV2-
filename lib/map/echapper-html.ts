/**
 * @file lib/map/echapper-html.ts
 *
 * Échappement du contenu injecté dans les popups MapLibre.
 *
 * ── Pourquoi ce module existe ───────────────────────────────────────────────
 *
 * Les treize `setHTML()` du projet construisent leur HTML par interpolation de
 * chaînes, à partir de valeurs venues de la base :
 *
 *     .setHTML(`<b>${props.nom}</b><br/><span>${props.adresse}</span>`)
 *
 * Or `nom`, `adresse`, `ville`, `exploitant` viennent de `poi_france` et
 * `panneaux_affichage`, **alimentées par des imports CSV, XLSX et ArcGIS**.
 * Dans un SaaS multi-tenant, un fichier de POI dont un champ contient
 * `<img src=x onerror=…>` s'exécute chez quiconque clique sur ce point.
 *
 * La seule protection était le `DOM.sanitize()` de MapLibre — précisément
 * celui qui porte la faille XSS de `maplibre-gl` <= 6.4.0 (il laissait passer
 * un attribut dangereux quand deux se suivaient). Se reposer dessus n'était
 * donc pas seulement fragile en principe : c'était fragile en fait.
 *
 * Échapper à la source rend la question sans objet, que le sanitizer de
 * MapLibre soit corrigé ou non. C'est de la défense en profondeur, pas un
 * palliatif en attendant la v6.
 *
 * ── Ce qu'il faut échapper, et ce qu'il ne faut PAS échapper ────────────────
 *
 * Échapper : toute **donnée** — texte venu de la base, d'un import, d'une API.
 *
 * Ne pas échapper : le **balisage que nous assemblons nous-mêmes** (une liste
 * de `<li>` déjà construite, un badge). L'échapper afficherait les balises en
 * clair. Dans ce cas, ce sont les valeurs injectées AU MOMENT DE SA
 * CONSTRUCTION qui doivent passer ici.
 *
 * ── Ce qui a été laissé NON échappé, délibérément (audit du 2026-09-11) ─────
 *
 * Neuf interpolations subsistent sans `esc()`. Chacune a été vérifiée, aucune
 * ne peut porter du texte d'attaquant — inutile de rouvrir la question :
 *
 *   `fmtNum(p.impressions)`, `fmtNum(p.pop_value)` — `fmtNum` force un
 *       `Number()` et renvoie `'—'` si le résultat n'est pas fini.
 *   `civicLevelLabel(...)` — lit des tables de libellés fixes, renvoie `'—'`
 *       ou `'indisponible'` hors domaine.
 *   `colors[...]`, `meta.label`, `meta.unit` — constantes de module
 *       (`VAR_META`, palettes), pas des données.
 *   `entry.indice_global`, `entry?.nbCommunes` — entiers de nos propres
 *       routes API, adossés à des colonnes entières en base.
 *   `entry.stale ? '…' : ''` — littéraux.
 *   `p.categorie_arcom` — échappé en aval, par le `.map(esc)` de la ligne
 *       qui l'assemble.
 */

/**
 * Rend une valeur inerte dans un contexte HTML.
 *
 * Les cinq caractères couverts sont ceux qui permettent de sortir d'un nœud
 * texte ou d'une valeur d'attribut. L'apostrophe est incluse — l'ancienne
 * version locale de `useMapMarkers.ts` l'omettait, ce qui laissait une sortie
 * possible depuis un attribut délimité par des quotes simples.
 *
 * `&` est traité en premier, sans quoi les `&` des entités produites ensuite
 * seraient ré-échappés (`<` deviendrait `&amp;lt;`).
 *
 * La signature accepte `unknown` à dessein : les propriétés d'une feature
 * MapLibre arrivent en `Record<string, unknown>`, et exiger un `string` ici
 * imposerait un cast à chaque appel — trente occasions de se tromper, dont
 * certaines feraient passer un objet pour une chaîne sans que rien ne le
 * signale. Une fonction de frontière doit accepter ce que la frontière laisse
 * passer.
 *
 * @param valeur valeur à rendre inerte ; `null`/`undefined` donnent `''`
 */
export function echapperHtml(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
