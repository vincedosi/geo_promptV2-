# La carte en parcours — finitions de ③ Zones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular (pas de port ici, mais ses pièges AIDA et sa méthode de parité valent). Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** 7 tâches en 2 groupes, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (mineurs en T7), **une seule preuve navigateur**, en T7. Cible : **≈ 2,3 jours** (T3 compris ; 2,05 j sans lui si Q-8 = abandon).

**Goal :** ③ Zones fini au sens de Vincent : (1) **ce que la spec promet et que le code ne tient plus** — capturer une bataille en zone (cassé depuis le retrait de la V1 le 27/10) ; (2) **les points V-1 à V-9 du lot 3** (Excel n° 24, spec § 17 bis) tranchés et, pour ceux qui coûtent peu, faits ; (3) **les défauts vus en preuve** et jamais repris (l'aperçu ne recadre pas, le message « Zone créée » s'attarde) ; (4) **l'écart à la spec V1** (§ 19) qu'est le script de custom bidding dans « Mes zones » ; (5) les 93 zones CIRFA orphelines (Excel n° 23), selon Q-8.

**Architecture (le moins de code possible) :** aucune refonte du panneau. Le panneau ③ par familles (lot 3), les créateurs (lot 4), « Mes zones » et la capture restent tels quels. Une seule route neuve (`POST /api/zones/[id]/dupliquer`), une jumelle SQL (`zone_seuil_carreaux_min`, l'originale devient son enveloppe), une migration de données conditionnelle (CIRFA). Le reste est Angular, dans des fichiers existants.

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 16 fait foi** (16.1 ligne ③, 16.2 règles 1, 2 et 5, 16.3 recettes, 16.8 A-1 à A-7), § 17 bis (écarts du lot 3, V-1 à V-9), § 18 (③ vit dans l'onglet Insights : rien à faire ici, tout l'état reste dans l'URL du § 5), § 19.3 et 19.4 (custom bidding = temps 2, « à NE PAS porter »). Plans antérieurs : `2026-10-14-carte-en-parcours-lot-3.md`, `2026-10-26-carte-retours-26-10.md`.

## Global Constraints

- **Aucune modification React.** React est gelé (A-5 du § 16.8) ; il garde `/api/custom-geo/save`, son bouton de script de custom bidding et sa bataille non capturable. Écarts listés en T7.
- **Fichier protégé** `app/api/isochrone-battle/route.ts` : NON touché. La route lue par la V2 est `app/api/isochrone-battle-v2/route.ts`, et ce lot ne la modifie pas non plus (elle rend déjà la clé, voir E1).
- **Aucun `DROP FUNCTION`** : le seuil sur carreaux gagne une **jumelle** (`zone_seuil_carreaux_min`, nouveau paramètre) et l'originale devient une enveloppe mince qui l'appelle avec `0` — un seul corps, les zones d'avant le lot se recalculent à l'identique.
- **A-2 tient** : « Dupliquer » ne modifie jamais la zone source ; une zone citée par un plan reste intouchée.
- Routes : `force-dynamic`, Zod, `lireCorps()`, `getSession` sur `/api/*`, `createAdminClient()`, erreurs supabase-js lues, quota par `lib/api/rate-limit.ts` (le préfixe `geo:rl:zones` d'A-7, pas un nouveau).
- **Aucune donnée de démo.** Les zones de preuve sont supprimées en T7. La migration CIRFA (T3) n'écrit QUE des géométries existantes de `geography_zones`.
- Fichiers `.ts` < 400 lignes : `etat/jeu-zones.service.ts` est à **400/400** (non touché), `panneaux/zones/mes-zones.component.ts` à **371**, `panneaux/zones/plan-media.component.ts` à 373 — « Dupliquer » passe par `carte-zone.component.ts` (197) et une méthode d'API, pas par du gabarit ajouté à `mes-zones`.
- Textes en sentence case, vouvoiement, jetons `var(--…)` seulement, Inter + JetBrains Mono, bordures 0,5 px.
- Preuve sur **:3002 / :4202** (serveurs du worktree), jamais :3000 / :4200.

## Review Focus

1. **Capture de la bataille V2** (T4) : la clé reçue de la route est celle du PÉRIMÈTRE de l'appelant (`__p<empreinte>`) — `custom-geo/source/battle` la refuse sinon ; une bataille d'un autre espace n'est jamais capturable. La recette écrite est `isochrone` figée avec `paliers` en chaîne, comme la V1.
2. **Recalcul à l'identique** (T1) : une zone « seuil sur carreaux » enregistrée AVANT le lot (recette sans `min_menages`) se recalcule avec la même forme (test d'intégration : même nombre de carreaux, même surface).
3. **« Dupliquer » n'écrit qu'une zone** (T2) : jamais la source, jamais deux fois sur un double clic (route non idempotente, même garde que l'atelier), géométrie copiée côté serveur (rien ne transite par le navigateur).
4. **Aucune lecture neuve à l'ouverture de ③** (T6) : le recadrage de l'aperçu lit l'emprise de la réponse d'aperçu déjà reçue ; le compteur réseau de `carte.page.spec.ts` ne bouge pas.
5. **Migration CIRFA rejouable** (T3) : une seconde exécution n'ajoute rien ; aucune ligne de `geography_zones` modifiée ni supprimée.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 29/10, worktree `carte-finitions`, HEAD `857ac3ed`)

### L'état de ③ (Angular)

| Brique | Fichiers | État |
|---|---|---|
| Panneau par familles, tiroirs exclusifs, pied unique | `panneaux/zones/panneau-zones.component.ts` (230 l.), `pied-recette.component.ts` (161), `etat/atelier-zone.service.ts` (154) | livré (lot 3 T10, retours 26/10 T7) |
| Autour des POI | `creer-rayon.component.ts` (rayon autour d'un point, lot 4), `recette-rayon-poi.component.ts` (rayon autour d'un type, métropole admise sous borne depuis le 26/10) | livré |
| Par seuil | `recette-seuil-carreaux.component.ts` (≤ département, A-4), `recette-seuil-territoire.component.ts` (IRIS / CP) ; métropole → `seuil_metropole_differe` | livré ; la métropole attend Excel n° 44 (hors lot) |
| À la main | `creer-dessin.component.ts`, `recette-import.component.ts` (GeoJSON / KML), `creer-codes-postaux.component.ts` | livré |
| Capture | `capture.component.{ts,html}`, `logique/zones/capture.ts`, `etat/capture.service.ts` | livré, **mais la bataille n'y entre plus (E1)** |
| Mes zones (boîte à outils) | `mes-zones.component.ts`, `carte-zone.component.ts`, `operations-zones.component.ts`, `jeux-de-zones.component.ts`, `plan-media.component.ts` | livré (lot 4 T14 + lot 3 T12 : recette, Recalculer, combinaisons) |

**Parité React** (`app/map/_components/panneaux/PanneauZones.tsx`, 161 l.) : React aligne « Capturer zone custom », codes postaux, rayon, dessin, « Jeux de zones à risque » et « Mes zones » dans UN panneau. L'Angular range les créateurs par familles (§ 16.3) et met « Mes zones » et les jeux dans la boîte à outils (décision du 13/10) : écart **voulu**, déjà documenté. Les libellés et contrôles des trois créateurs et de « Mes zones » ont été relevés le 29/10 (chaînes visibles des deux côtés) : aucun manque. La vérification côte à côte reste due en T7 (preuve navigateur).

### Écarts constatés dans le code

| # | Constat (fichier:ligne) | Gravité | Tâche |
|---|---|---|---|
| E1 | **La bataille ne se capture plus.** Depuis le retrait de la V1 (`210404df`, 27/10), seule la V2 peint ; elle pose `cle: null` (`etat/bataille-v2.service.ts:168`), et `sourceCaptureBataille` rend `null` sans clé (`couches/bataille.service.ts:197`) : la couche n'est pas comptée, « Capturer zone custom » l'ignore. Or la route V2 **rend déjà** `battleCacheKey` (calculée `app/api/isochrone-battle-v2/route.ts:137`, rendue en cache `:156` et après calcul `:306`), clé suffixée `__p<empreinte>` que `cleDeCacheDuPerimetre` accepte, et le cache V2 écrit `geojson.battleGeoJSON` (`:295`), exactement ce que lit `get_battle_geometry` (`supabase/migrations/20260428_fix_get_battle_geometry_read_jsonb.sql`). Le renvoi de ③ (« Isochrones et bataille : lancez-les à l'étape ④, puis capturez le résultat ici », `panneau-zones.component.ts`) **ment** deux fois : la capture échoue, et l'outil « Isochrones » n'existe plus en ④. | **Critique** (promesse de la spec § 16.3 cassée) | T4 |
| E2 | L'aperçu d'une recette ne recadre pas la carte (vu en preuve le 16/10, toujours vrai : `couches/apercu-zone.ts` ne fait aucun `fitBounds`). Une zone calculée hors de la vue est invisible. | Important | T6 |
| E3 | Le message « Zone créée » reste affiché après l'enregistrement (`atelier-zone.service.ts:117`, « le message reste ») jusqu'au prochain aperçu, y compris quand on change de famille ou de formulaire. | Mineur | T6 |
| E4 | « Mes zones » propose « Générer le script custom bidding DV360 » (`carte-zone.component.ts:118`). La spec § 19.3/19.4 met le custom bidding au temps 2 et le classe « à NE PAS porter ». | Important (écart à la spec) | T5, Q-6 |
| E5 | V-2 : un carreau dont le dénominateur imputé est minuscule passe le seuil (0,4 ménage → 100 %) ; `zone_seuil_carreaux` (sql/255) n'exclut que `den = 0`. | Important (zones fausses) | T1, Q-2 |
| E6 | V-4 : pas de « Dupliquer ». Une zone citée par un plan ne se recalcule pas (A-2, 409) et rien ne permet d'en refaire une à jour. | Important | T2 + T5, Q-3 |
| E7 | V-6 : « Créer la zone » du score composite écrit `{ type: 'capture', source_type: 'score' }` sans indicateurs ni poids (`etat/score-composite.service.ts:134`) : la provenance est perdue. | Mineur | T5, Q-4 |
| E8 | V-8 : codes région / département comparés tels quels (sql/253, 256) ; « 2a » minuscule → résultat vide en silence. | Mineur (dette) | T1, Q-5 |
| E9 | 93 zones CIRFA dans `geography_zones`, créées le 13/04, lues par aucun code (mémoire `project_zones_cirfa_orphelines`, Excel n° 23). | Décision | T3, Q-8 |
| E10 | Texte teal sur fond clair (bouton « Capturer zone custom », `.cta-teal` des recettes) à ≈ 1,8:1 — Excel n° 45, 54 occurrences sur toute la carte. | Décision de design | hors lot, Q-7 |

### Mesures I/O

**La base locale était arrêtée au moment du pré-vol** (Docker Desktop éteint ; non relancé : RAM du poste). Aucune requête n'est nouvelle sauf la jumelle de T1 et la copie de T2 ; les mesures sont donc **portées par les tâches**, avant tout code :

| Requête | Ce qu'on sait | Mesure exigée (dans la tâche) |
|---|---|---|
| `get_battle_geometry` sur une clé V2 (T4) | RPC existante, une ligne lue par clé ; l'union porte sur `nb_features` anneaux (≈ 7 paliers × N POI) | `EXPLAIN (ANALYZE, BUFFERS)` sur une bataille V2 d'un département ET sur la plus grosse V2 en cache (`order by poi_count desc limit 1`) ; si > 5 s, la capture la refuse avec un message (plafond écrit) |
| `zone_seuil_carreaux_min` (T1) | même plan que sql/255 + un prédicat `den >= p_min` : ne lit pas plus | Gironde et Bouches-du-Rhône à `part_men_pauv ≥ 40`, avec 0 et 11 : buffers identiques (± 5 %), carreaux retenus comptés (chiffre pour Q-2) |
| `dupliquer` (T2) | figée : un `INSERT … SELECT` d'une ligne de `custom_geo_zones` ; recalculable : l'exécuteur existant, sous quota | `EXPLAIN` de l'`INSERT … SELECT` sur la plus grosse zone (`order by st_npoints(geom) desc limit 1`) |
| Migration CIRFA (T3) | 93 lignes, ≈ 5 Mo de géométries, une seule fois | `select count(*), pg_size_pretty(sum(pg_column_size(geom)))` avant ; durée de la migration ; AUCUNE résolution de codes dans la migration |

### Lignes de l'Excel qui touchent ③ (relevées, pas entrées d'office)

| N° | Ligne | Place |
|---|---|---|
| 24 | Lot 3 — points V-1 à V-9 (« à trancher », S, P2) | **dans le lot** : Q-2 à Q-5, T1, T2, T5 |
| 23 | Zones CIRFA orphelines (migrer ou abandonner, S, P2) | **dans le lot si Q-8 = migrer** : T3 |
| 44 | Calculs longs en tâche de fond (« Par seuil » métropole, bataille nationale), L, P1 | **hors lot** : repoussé après ⑧ le 27/10 ; ③ garde `seuil_metropole_differe` |
| 35 | Basic-Fit : une zone par emplacement (rayon ou isochrone) | **hors lot** : dépend de la réintégration du clustering (n° 34) et d'ORS par lots |
| 22 | Filtre par nature des jeux de zones | **hors lot** : ⑤ |
| 45 | Contraste du texte teal en thème clair | **hors lot** : décision de design globale, Q-7 |
| 33 | CIRFA de la Marine — vérifier qu'ils y sont tous (POI) | **hors lot** : ② / données |

### Numéros SQL (revérifiés le 29/10)

`ls sql .claude/worktrees/*/sql` : dernier pris **290** (catalogue : 288-290). ⑧ Live (`feat/carte-live`) annonçait `sql/288_livraison_plateformes`, « à renuméroter » : il prendra **291**. Ce lot prend donc **292** (T1) et **293** (T3). **À revérifier au moment de T1 et de T3** (`ls sql .claude/worktrees/*/sql | grep -E '^29[0-9]_'`) ; si ⑧ a pris plus d'un numéro, décaler.

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Capture de la V2 | `BatailleV2Service.terminer` passe `cle: r.battleCacheKey ?? null` (type `ResultatV2` complété). AUCUNE route modifiée. Le renvoi de ③ devient « La bataille d'isochrones se lance à l'étape ④ ; capturez ensuite son résultat ici. » | — |
| A-2 | Sous-zones d'une V2 | `enrichissementBataille` lit `poi_id` / `palier` dans les propriétés des anneaux : **vérifier en T4** que les anneaux V2 les portent (RPC de la V2). S'ils ne les portent pas : recette `isochrone` sans sous-zones (la forme reste juste), dit dans le rapport ; pas de RPC modifiée dans ce lot. | des sous-zones par POI plus tard |
| A-3 | V-2 (Q-2) | Jumelle `zone_seuil_carreaux_min(…, p_min_den numeric)` ; l'originale = enveloppe avec `0`. Recette `seuil_carreaux` : `parametres.min_menages` (entier ≥ 0, absent = 0 → zones d'avant le lot à l'identique). Une NOUVELLE recette porte **11** par défaut (reco Q-2), affiché dans le formulaire (« Carreaux d'au moins 11 ménages ») et dans `libelleRecette`. Le minimum s'applique au dénominateur (`men` ou `ind` selon l'indicateur). | une valeur par défaut |
| A-4 | V-8 (Q-5) | Normalisation dans le **schéma Zod** de la recette (`lib/zones/recette-schema.ts` : `trim().toUpperCase()` sur les codes région / département) — pas de SQL : la base reçoit toujours des codes propres. | deux `upper(trim())` en SQL |
| A-5 | V-4 (Q-3) | `POST /api/zones/[id]/dupliquer` `{ nom }` : zone de l'espace actif (sinon 404, comme inconnue) ; recette recalculable → l'exécuteur l'exécute À NEUF (forme à jour, nouveau périmètre enregistré identique) ; forme figée ou recette nulle → copie SQL de la forme (`INSERT … SELECT`, aucune géométrie au navigateur), `recette` copiée ; `source_metadata.duplique_de = <id>`. Quota `geo:rl:zones`. Nom par défaut côté écran : « <nom> (copie) ». Le libellé du bouton dit ce qu'il fait : « Recalculer dans une nouvelle zone » pour une recette recalculable citée (409), « Dupliquer » sinon. | une option « copie exacte » |
| A-6 | V-6 (Q-4) | La recette du score composite garde sa provenance : `parametres: { indicateurs: [{ code, poids, sens }], maille, seuil_score }` (ce que l'outil envoie déjà à la route source) ; elle reste **figée** (non recalculable). | — |
| A-7 | E4 (Q-6) | Le bouton « script custom bidding » sort de `carte-zone.component.ts` (Angular) ; « Exporter TikTok » reste. Le format `bidding_script` reste servi par la route (React l'emploie). | remettre un bouton |
| A-8 | E2 | L'aperçu recadre la carte sur l'emprise de la forme prévisualisée (`marge-carte.ts`, la fonction de recadrage qui tient compte du panneau), seulement si la forme n'est pas déjà entièrement visible ; jamais au recalcul d'un aperçu identique. | — |
| A-9 | E3 | Le message de réussite s'efface au prochain changement de formulaire actif, de famille ou de recette (pas de minuterie). | — |
| A-10 | V-1, V-3, V-7, V-9 | **Gardés tels que le lot 3 les a tranchés** (périmètre qui borne ; « Restreindre à » entre deux zones ; plafond de 12 000 km² ; quota). Rien à coder. | voir § 17 bis |
| A-11 | CIRFA (Q-8 = migrer) | `sql/293_cirfa_vers_zones.sql` : `INSERT INTO custom_geo_zones … SELECT … FROM geography_zones` des 93 CIRFA, espace **Marine nationale** (id lu par nom dans la migration, échec explicite si absent), `source_type 'import'`, recette figée `{ v: 1, type: 'import', parametres: { origine: 'geography_zones', cree_le: '2026-04-13' } }`, idempotente (`where not exists` sur `source_metadata->>'geography_zone_id'`). Codes CP / IRIS **non résolus** dans la migration (règle 2 du § 16.2 : la forme est la vérité ; ⑤ convertit) ; « Mes zones » les montre sans comptes. `geography_zones` n'est PAS touchée. | une suppression ciblée par `source_metadata` |

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Capturer la bataille d'isochrones en zone** ne marche plus depuis qu'on a retiré la V1 (27/10). On la rebranche sur la V2, sans toucher aux routes ? | T4 | **[Oui : la spec le promet, deux lignes de code.]** |
| Q-2 | **Seuil sur carreaux** : un carreau de 0,4 ménage passe à « 100 % de ménages pauvres ». On ignore les carreaux de **moins de 11 ménages** (seuil du secret statistique INSEE, en dessous les valeurs sont imputées), réglable dans le formulaire ? Les zones déjà créées ne changent pas. | T1, T6 | **[Oui, 11 par défaut ; le chiffre des carreaux écartés est mesuré en T1 avant de coder.]** |
| Q-3 | **Ajouter « Dupliquer »** dans Mes zones ? Pour une zone utilisée par un plan, il devient « Recalculer dans une nouvelle zone » (l'originale, achetée, ne bouge pas). | T2, T5 | **[Oui.]** |
| Q-4 | **Zone issue du score composite** : garder ses indicateurs et poids dans la zone (pour savoir d'où elle vient), sans la rendre recalculable ? | T5 | **[Oui.]** |
| Q-5 | **Codes de département en minuscules** (« 2a ») : les corriger à l'entrée plutôt que de rendre une zone vide ? | T1 | **[Oui, dans la validation, sans SQL.]** |
| Q-6 | **Script de custom bidding DV360** dans Mes zones : on le retire de l'Angular, puisque la V1 ne fait que du contrôle des impressions (§ 19) ? React le garde. | T5 | **[Oui.]** |
| Q-7 | **Contraste du teal en thème clair** (Excel n° 45) : on le traite pour toute la carte en une fois, après ce lot, plutôt que ③ seul ? | hors lot | **[Oui : une règle unique, comme `--teal-texte` de l'admin ; ③ n'y touche pas.]** |
| Q-8 | **93 zones CIRFA orphelines** (Excel n° 23) : on les range dans « Mes zones » de l'espace Marine nationale (formes figées, sans conversion) ou on les abandonne ? | T3 | **[Migrer : géométrie façonnée, irremplaçable, 5 Mo ; coût S.]** |

En attendant les réponses, le plan applique les recommandations ; chaque arbitrage dit son coût si la réponse est autre. Une réponse « non » à Q-1/Q-3/Q-6/Q-8 retire la partie concernée de sa tâche, sans effet sur les autres.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/292_zone_seuil_carreaux_min.sql` (neuf) | jumelle `zone_seuil_carreaux_min`, enveloppe `zone_seuil_carreaux` | T1 |
| `lib/zones/recette-schema.ts`, `lib/zones/recette.ts`, `lib/zones/executer-recette.ts` | `min_menages`, codes normalisés, appel de la jumelle | T1 |
| `app/api/zones/[id]/dupliquer/route.ts` (neuf), `lib/zones/dupliquer.ts` (neuf, pur + appel) | « Dupliquer » | T2 |
| `sql/293_cirfa_vers_zones.sql` (neuf, si Q-8) | migration des 93 CIRFA | T3 |
| `tests/integration/zones-finitions.test.ts` (neuf) | recalcul à l'identique (T1), dupliquer (T2), migration rejouable (T3) | T1-T3 |
| `angular/…/carte/etat/bataille-v2.service.ts`, `logique/bataille/*` (type `ResultatV2`), `panneaux/zones/panneau-zones.component.ts` | capture de la V2, texte du renvoi | T4 |
| `angular/…/carte/panneaux/zones/{carte-zone.component.ts, mes-zones.component.ts}`, `data/zones.api.ts`, `etat/score-composite.service.ts`, `logique/zones/recette.ts` (copie paritaire) | Dupliquer, retrait du script, provenance du score, `min_menages` | T5 |
| `angular/…/carte/{etat/atelier-zone.service.ts, couches/apercu-zone.ts, panneaux/zones/recette-seuil-carreaux.component.ts, panneaux/zones/pied-recette.component.ts}` | recadrage, message, champ « au moins N ménages » | T6 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md`, spec § 17 bis (ligne « Suites ») | doc dans le commit de chaque tâche serveur, puis T7 | T1-T3, T7 |

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Racine d'ombre : jamais `document`, jamais `position: fixed` ; écouteurs sur l'élément du composant.
- Signals, `OnPush`, aucun calcul dans le gabarit ; `input()` réactif ; abandonner la lecture en vol au changement d'entrée.
- MapLibre : jamais `var()` dans `paint` (couleurs par `CouleursService`) ; `fitBounds` par `marge-carte.ts` (le panneau masque la gauche de la carte).
- `POST /api/zones` et `…/dupliquer` ne sont PAS idempotents : bouton inactif dès le 1er clic, réponse perdue → « vérifiez Mes zones », 207 = réussite (patron de `atelier-zone.service.ts`).
- Copies paritaires verrouillées (`recette.ts` ↔ `lib/zones/recette.ts`) : changer les deux, le test `toEqual` doit rester vert.
- Deux thèmes prouvés ; fichiers < 400 lignes ; aucune lecture à l'ouverture de ③.

---

## Groupe A — serveur (relecture 1)

### Task 1 : seuil sur carreaux sans carreaux imputés, codes normalisés (effort S-M, 0,3 j)

- [x] **Mesure d'abord** (base locale ; si Docker est éteint, le relancer par `scripts/local/00-docker-up.sh` puis `01-supabase-up.sh`, une seule fois) : `EXPLAIN (ANALYZE, BUFFERS)` de `zone_seuil_carreaux('part_men_pauv','>=',40,'departement','33',…)` et `'13'` ; puis, en lecture, le nombre de carreaux retenus avec `men >= 11` vs sans. Chiffres dans le rapport (Q-2).
- [x] Revérifier le numéro libre (292). Tests d'abord : `tests/integration/zones-finitions.test.ts` — (a) recette sans `min_menages` → même nombre de carreaux et même surface qu'avant (valeurs mesurées ci-dessus, écrites dans le test) ; (b) `min_menages: 11` → moins de carreaux, aucun carreau de `men < 11` (contrôle par `ST_Intersects` sur 3 carreaux connus) ; (c) recette `seuil_territoire` avec `code: ' 2a '` → même résultat que `'2A'`. `tests/unit/zones/recette-schema.test.ts` : normalisation, `min_menages` entier ≥ 0, borne haute 1 000. FAIL attendu.
- [x] `sql/292_zone_seuil_carreaux_min.sql` : jumelle (corps de sql/255 + `and <den> >= p_min_den`), enveloppe `zone_seuil_carreaux` → jumelle avec `0`, `comment on`, `grant` identiques. Appliquer en local, rejouer une 2ᵉ fois sans effet. `EXPLAIN` de la jumelle à 11 : buffers ± 5 % de la mesure initiale.
- [x] `recette-schema.ts` (A-3, A-4), `recette.ts` (`libelleRecette` : « … · carreaux d'au moins 11 ménages » si > 0), `executer-recette.ts` (appel de la jumelle). Recalcul : le paramètre vient de la recette enregistrée, jamais d'un défaut serveur.
- [x] `ARCHITECTURE.md` (`Grep "zone_seuil_carreaux"`) ; `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [x] Commit `feat(db): seuil sur carreaux sans carreaux imputés, codes de territoire normalisés (③ finitions, T1)`.

### Task 2 : « Dupliquer » une zone (effort S-M, 0,35 j)

- [x] Tests d'abord (`zones-finitions.test.ts`) : zone figée → nouvelle zone, même `ST_Area`, `recette` copiée, `source_metadata.duplique_de` ; zone à recette recalculable citée par un jeu de zones → nouvelle zone calculée à neuf, l'originale inchangée (`updated_at` identique) ; zone d'un autre espace → 404 ; nom vide → 400 ; quota partagé avec `POST /api/zones` (13ᵉ appel de la minute → 429). Unitaire `lib/zones/dupliquer.ts` (choix copie / exécution selon la recette). FAIL attendu.
- [x] Route (A-5), `lib/zones/dupliquer.ts`. Copie figée : d'abord chercher une RPC existante qui copie une ligne de `custom_geo_zones` côté base (`grep -rn "custom_geo_zones" sql`) ; à défaut, une petite RPC `jsonb` neuve `dupliquer_zone(p_id, p_nom, p_org)` (`INSERT … SELECT … RETURNING id`, une ligne, numéro libre suivant, sans `DROP`), nommée dans le rapport — jamais une géométrie relue puis renvoyée par Node. `EXPLAIN` de la copie sur la plus grosse zone (chiffre dans le rapport). Inscrire la route dans les tests de périmètre (`perimetre-routes.test.ts`) et de validation des corps.
- [x] `ARCHITECTURE.md` (route neuve) ; tsc, unit, integration.
- [x] Commit `feat(api): dupliquer une zone, recalculée à neuf si sa recette le permet (③ finitions, T2)`.

### Task 3 : les 93 zones CIRFA dans « Mes zones » de la Marine (effort S, 0,25 j — si Q-8 = migrer)

- [x] Mesure : `select count(*), pg_size_pretty(sum(pg_column_size(geom))) from geography_zones` (attendu 93, ≈ 5 Mo), colonnes réelles (`\d geography_zones`), validité (`count(*) filter (where not st_isvalid(geom))`), SRID. Relire `sql/133`, `sql/134` et l'encart « Ménage en base du 2026-09-11 » d'`ARCHITECTURE.md`.
- [x] Revérifier le numéro libre (293). Tests d'abord : 93 zones de `source_metadata.origine = 'geography_zones'` dans l'espace Marine nationale, aucune ailleurs ; rejouer la migration → toujours 93 ; `geography_zones` inchangée (compte + somme des aires). FAIL attendu.
- [x] `sql/293_cirfa_vers_zones.sql` (A-11) : `ST_MakeValid` si des invalides, `ST_Multi`, SRID 4326, `geom_3857` si la table le porte ; aucune résolution de codes. Appliquer, rejouer.
- [x] `ARCHITECTURE.md` (encart du ménage : « migrées le … ») ; mémoire `project_zones_cirfa_orphelines` à clore en T7.
- [x] Commit `feat(db): les 93 zones CIRFA rejoignent les zones de la Marine nationale (③ finitions, T3)`.

## Groupe B — Angular (relecture 2)

### Task 4 : la bataille se capture de nouveau (effort S, 0,3 j)

- [x] Mesure (base locale) : `EXPLAIN (ANALYZE, BUFFERS) select get_battle_geometry(array['<clé V2 d'un département>'])` et sur la plus grosse V2 en cache ; lire les propriétés d'un anneau V2 (`geojson->'battleGeoJSON'->'features'->0->'properties'`) pour A-2. Si > 5 s sur la plus grosse : la capture d'une bataille au-delà d'un nombre de POI à écrire (mesuré) est refusée avec un message, chiffre dans le rapport.
- [x] Specs d'abord : `bataille-v2.service.spec.ts` — un résultat portant `battleCacheKey` la pose sur le créneau (`BatailleService.cle()`), un résultat sans clé pose `null` ; `capture.service` compte la bataille V2 ; `capture.spec` / `logique/zones/capture.spec.ts` — recette `isochrone` figée, `paliers` « 10,20,30,… » (chaîne), sous-zones selon A-2 ; `panneau-zones.component.spec.ts` — nouveau texte du renvoi (A-1).
- [x] Implémentation (A-1, A-2). `ResultatV2` gagne `battleCacheKey?: string`.
- [x] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit -p angular`.
- [x] Commit `fix(angular): ③ capture de nouveau la bataille d'isochrones (V2) (③ finitions, T4)`.

### Task 5 : Mes zones — Dupliquer, sans script de bidding, score avec sa provenance (effort S-M, 0,35 j)

- [x] Specs d'abord : `carte-zone.component.spec.ts` — bouton « Dupliquer » (ou « Recalculer dans une nouvelle zone » quand le dernier recalcul a rendu 409 `zone_referencee`), aucun bouton `data-export="bidding_script"`, « Exporter TikTok » présent ; `mes-zones.component.spec.ts` — un clic = un appel, second clic ignoré en vol, 200 → liste relue et message « Zone dupliquée : <nom> », 207 → message de la route, statut 0 → « vérifiez Mes zones », 404 → message ; `score-composite.service.spec.ts` — `parametres` porte indicateurs, poids, sens, maille, seuil ; parité `recette.ts` (`min_menages` dans le libellé).
- [x] Implémentation : `ZonesApi.dupliquer(id, nom)`, sortie `dupliquer` de `carte-zone`, gestion dans `mes-zones` (≤ 400 lignes ; si ça déborde, extraire la gestion des gestes dans `logique/zones/gestes-zone.ts`), retrait du bouton (A-7), provenance (A-6), copie paritaire de `recette.ts`.
- [x] ng test, tsc.
- [x] Commit `feat(angular): Mes zones duplique une zone, sans script de bidding (③ finitions, T5)`.

### Task 6 : l'atelier recadre, efface son message, montre le minimum de ménages (effort S, 0,25 j)

- [x] Specs d'abord : `atelier-zone.service.spec.ts` — un aperçu reçu recadre une fois (emprise de la forme, via le recadrage à marge), un aperçu déjà visible ne recadre pas ; le message s'efface au changement de recette ou de formulaire actif (A-9) ; `recette-seuil-carreaux.component.spec.ts` — champ « Carreaux d'au moins N ménages » (11 par défaut, entier ≥ 0), la recette le porte ; `carte.page.spec.ts` — compteur de lectures à l'ouverture de ③ inchangé.
- [x] Implémentation (A-8, A-9, A-3 côté écran).
- [x] ng test, tsc.
- [x] Commit `fix(angular): ③ l'aperçu recadre la carte, le message de réussite s'efface (③ finitions, T6)`.

## Task 7 : revue finale, factorisation, preuve navigateur (effort 0,4 j)

- [x] Revue finale du lot (modèle le plus capable) : mineurs accumulés ; passe de factorisation (dire ce qui reste dupliqué : `recette.ts` ↔ `lib/zones/recette.ts`, dupliqués par construction et verrouillés).
- [x] **Preuve navigateur, une seule fois, deux thèmes** (`L-Z3-T7-*`, captures dans `.superpowers/sdd/2026-10-29-carte-en-parcours-zones/`), sur **:3002 + :4202**, React (:3002 `/map`) et Angular (:4202) côte à côte pour la parité des créateurs : (1) ④ bataille V2 (Marine nationale, CIRFA d'un département) → ③ « Capturer zone custom » compte la bataille → zone écrite, recette `isochrone` figée lue en base ; (2) « Par seuil » carreaux Gironde, 40 % ménages pauvres, 11 ménages → aperçu recadré, enregistrer, message effacé au changement de famille ; (3) « Dupliquer » une zone figée, puis « Recalculer dans une nouvelle zone » sur une zone d'un jeu de zones (409 d'abord) ; (4) Mes zones sans bouton de script de bidding ; (5) score composite → « Créer la zone » → `recette.parametres` en base ; (6) Marine nationale : les 93 CIRFA dans Mes zones (si T3) ; (7) rayon autour d'un point, dessin, import KML, codes postaux : mêmes contrôles et messages que React. Onglet réseau : aucune lecture à l'ouverture de ③. Zones de preuve supprimées, espace actif rétabli.
- [x] Écarts React à lister (README carte + spec § 17 bis, ligne « Suites ») : React ne capture pas la V2, garde le script de bidding, n'a ni « Dupliquer » ni le minimum de ménages (sa route `indicator-threshold` n'est pas touchée).
- [x] `ARCHITECTURE.md`, README carte (§ ③), spec § 17 bis (V-2, V-4, V-6, V-8 : « fait le … »), Excel n° 23 et 24 (État). Tests complets : `npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run lint`, `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites, `cd angular && npx ng build`.
- [x] Commit `docs: ③ Zones — revue finale et preuve navigateur (finitions, T7)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A serveur | T1, T2, T3 | 0,9 j (T3 : 0,25 j, retiré si Q-8 = abandon) |
| B Angular | T4, T5, T6 | 0,9 j |
| Fin | T7 | 0,4 j |
| Relectures | 2 | ≈ 0,1 j |
| **Total** | **7 tâches, 2 relectures, 1 preuve** | **≈ 2,3 jours** |

T4 (capture de la V2) ne dépend d'aucune tâche serveur : si Vincent veut le correctif critique tout de suite, il peut partir seul en premier, avant le groupe A.

## Critères de fin du lot

Une bataille V2 se capture en zone (recette `isochrone` figée) ; le seuil sur carreaux écarte les carreaux de moins de N ménages sans changer les zones existantes au recalcul ; « Dupliquer » et « Recalculer dans une nouvelle zone » existent et ne touchent jamais l'original ; la zone du score garde sa provenance ; Mes zones n'offre plus de script de bidding ; l'aperçu recadre et le message s'efface ; les 93 CIRFA sont dans Mes zones de la Marine (ou abandonnées, selon Q-8) ; React inchangé hors écarts listés ; tests et builds verts ; preuve navigateur dans les deux thèmes.

## Hors champ

« Par seuil » sur la métropole et bataille nationale en tâche de fond (Excel n° 44, après ⑧) ; seuil sur carreaux à la région (Q-G) ; zones météo (lot 10, Q-D) ; une zone par emplacement OOH (n° 35) ; filtre par nature (n° 22, ⑤) ; contraste du teal (n° 45, Q-7) ; liste à choix de la commune (Q-F, finition de ①) ; « Restreindre à » sur plus de deux zones (V-3) ; recalcul des isochrones par ORS (A-3 du § 16.8) ; résolution CP / IRIS des CIRFA migrées.
