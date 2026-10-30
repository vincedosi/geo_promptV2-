# La carte en parcours — finitions de ⑤ Jeu de zones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular (pas de port ici : ⑤ n'a pas d'équivalent React, mais ses pièges AIDA valent). Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** 7 tâches (T0 à T6) en 2 groupes, **un implémenteur et une relecture par groupe**. Seuls les défauts Critiques et Importants sont corrigés au fil de l'eau ; les mineurs vont en T6. **Une seule preuve navigateur**, en T6. Cible : **≈ 2,3 jours** (≈ 2 jours si Q-5 est refusée).

**Goal :** ⑤ Jeu de zones fini au sens de Vincent (estimé à 90 % le 30/10). Trois blocs :
1. **Le mode pays** (Excel n° 50, P1, décision Q-2 du 30/10) : une zone « France métropolitaine » ou « France entière » créée en ③ s'achète en ⑤ par le **ciblage pays natif** de chaque plateforme, sans liste de CP, jusqu'à l'extraction et au fichier de ⑦ (E1, E2).
2. **Les mineurs** laissés par la preuve T14 et la revue finale du lot 5 (E4 à E8).
3. **La spec et la doc remises d'équerre** : § 16.1, ligne ⑤ (« ce qui existe le 14/10 » n'a pas bougé depuis), § 8 et Excel n° 22 (E9, E11).

**Architecture (le moins de code possible) :** aucune refonte de ⑤. Une **maille de plus**, `pays`, portée comme les six autres par `plateformes_geo` (règle n° 3 du § 16.2 : jamais en dur).
- **SQL :** une migration, `sql/300_maille_pays.sql` : la contrainte de maille admet `pays`, une colonne `codes_pays` et quatre lignes. **Aucune RPC neuve, aucune RPC réécrite** : `creer_extraction_jeu_zone` (sql/278) accepte toute maille choisie dans `zone_set_plateformes`, et la couverture d'une zone pays existe déjà (sql/296).
- **Serveur :** la règle « quelle maille a un sens pour cette recette » dans `lib/zones/conversion.ts` (copie paritaire côté Angular). L'extraction ne refuse plus une zone pays. ⑦ gagne un format de fichier `pays`.
- **Angular :** le reste se fait dans des fichiers existants. Un seul fichier neuf, extrait d'un service au plafond (T0).

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md`.
- **§ 16 fait foi** : 16.1, ligne ⑤ (« l'utilisateur choisit la maille plateforme par plateforme ; lien vers sa doc officielle ; ce que la maille fait perdre ») ; 16.2, règles 2 (« la forme exacte est la vérité ») et 3 (« les règles des plateformes vivent dans une table »).
- **§ 8** : tableau natures × plateformes, colonnes « À VÉRIFIER ».
- **§ 17 quinquies** (écarts du lot 5) et **§ 17 sexies** (finitions de ④ : la zone pays, « ⑤ suivra »).

Plans antérieurs :
- `2026-10-24-carte-en-parcours-lot-5.md` (T1-T14 livrés ; registre `.claude/worktrees/carte-jeu-de-zones/.superpowers/sdd/2026-10-24-carte-en-parcours-lot-5/`, avec `final-review.md` et `progress.md`, non suivis) ;
- `2026-10-24-carte-en-parcours-lot-6-plan.md` (Q-3 : « le national passe par une zone France entière créée en ③ ») ;
- `2026-10-25-carte-en-parcours-lot-7-activation.md` (fichiers par plateforme) ;
- `2026-10-30-carte-en-parcours-analyse.md` (modèle de ce plan ; A-3, A-4 et A-5 : la zone pays).

Mémoire : `reference_dsp_maille_geo`, `feedback_polygones_pas_que_cp`, `project_jeux_de_zones`, `project_retours_carte_26_10`.

## Global Constraints

- **React est gelé** (P5). Aucun fichier de `app/map/**`, `components/**` ou `lib/navigation/**` n'est modifié. ⑤ n'a pas d'équivalent React. Les routes partagées touchées (`/api/custom-geo/[id]/export`, `/api/custom-geo/[id]`) ne changent que de **phrase** (T3). Chaque écart est listé en T6.
- **Fichier protégé** : `app/api/isochrone-battle/route.ts` et `middleware.ts` ne sont pas touchés.
- **Le moteur risque n'est pas modifié** : `jeu-risque-caracterisation.test.ts` (1 102 / 73,1 ; 931 / 79,8 ; empreinte v1) reste vert à chaque tâche.
- **Aucun `DROP`** de fonction ni de table. Une seule exception écrite : la contrainte `plateformes_geo_maille_check` est **redéfinie** dans un bloc gardé (on ne la redéfinit que si elle n'admet pas encore `pays`). C'est le patron de `custom_geo_zones_recette_forme` (sql/296, l. 56-75). La migration est appliquée DEUX fois, à empreinte identique. `sql/284` n'est toujours PAS appliquée (au merge dans `feat/angular-lot0`).
- **PostgREST coupe à 1 000 lignes** : aucune RPC neuve ici. La couverture pays par CP (5 956 lignes) passe déjà par une RPC `jsonb` (sql/296).
- **I/O de la base** (CLAUDE.md § Disk I/O) :
  - **une zone pays ne lit aucun carreau**, en ⑤ comme en ④ : la maille `pays` se chiffre par la couverture « telle quelle » de la zone pays (`couverture_pays_jsonb`, `forme`, 4,6 ms mesurés) ;
  - une maille sans objet pour la recette (A-3) **ne part pas** : ni requête, ni quota consommé ;
  - quotas inchangés (`geo:rl:couverture`, `geo:rl:conversion`, `geo:rl:zone-sets`) ; au plus 3 appels Supabase simultanés ;
  - **ouvrir ⑤ ne lit rien** tant qu'aucune zone n'est choisie : le compteur réseau de `carte.page.spec.ts` ne bouge pas.
- **Aucune donnée de démo.** Les zones pays et les jeux de la preuve sont supprimés en T6, l'espace actif est rétabli.
- **Fichiers sous 400 lignes.** À ce jour, au plus près du plafond :
  - `angular/…/carte/etat/jeu-zones.service.ts` : **400, au plafond** (E3, T0) ;
  - `app/api/zones/jeux/[id]/extractions/route.ts` : 399 (non touché : la logique vit dans `lib/zones/extraction-jeu-zone.ts`, 297) ;
  - `angular/…/carte/couches/jeu-carte.service.ts` : 259 ; `lib/zones/fichiers-plateformes.ts` : à mesurer en T3.
- Routes : `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()`, garde `requireAuth(request)` dans le source, espace = `espaceDeZone`, `createAdminClient()`, erreurs supabase-js lues.
- Textes en sentence case et au vouvoiement. Couleurs par `var(--…)` seulement (MapLibre : valeurs calculées de `CouleursService`). Badge neutre « À vérifier », jamais une couleur de statut pour une incertitude documentaire.
- `ARCHITECTURE.md` (par `Grep` sur le nom : `plateformes_geo`, `zone_set_extraction_unites`, `fichier`) et `angular/src/app/features/carte/README.md` mis à jour dans le commit de chaque tâche qui touche une table, une route ou un service. Types régénérés dans le commit de la migration (le diff n'ajoute QUE la colonne).
- La preuve se fait sur **:3002 / :4202** (serveurs du worktree), jamais sur :3000 / :4200. Aucun serveur n'est lancé avant T6.

## Review Focus

1. **Le mode pays ne lit aucun carreau** (T2, T4) : sur une zone pays, la maille `pays` se chiffre par la couverture « telle quelle » (dénominateurs nationaux) ; les mailles sans objet (cercle, commune, IRIS) ne partent jamais.
2. **Une seule règle « maille sans objet »** (T2, T4) : la même fonction pure côté serveur (refus d'enregistrer, d'extraire) et côté écran (pastille grisée). Le verrou `conversion-paritaire.test.ts` est complété, pas contourné.
3. **L'extraction pays est autoportée** (T2) : ses unités (codes pays et population) sont figées depuis `plateformes_geo.codes_pays` au moment de l'extraction. Changer la table après coup ne change pas une extraction relue.
4. **Rien ne change pour une zone non pays** (T1-T5) : la maille `pays` n'y est jamais proposée, les défauts de maille et les extractions existantes sont identiques, octet pour octet (tests de conversion et de fichiers inchangés et verts).
5. **⑦ ne ment pas** (T3) : le fichier d'une plateforme au pays dit ce qu'il faut régler dans la plateforme. La poussée DV360 par API reste au CP et dit « aucun code postal à pousser » (motif existant `aucun_cp_dv360`).

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 30/10, worktree `carte-finitions`, HEAD `84726702`)

### L'état de ⑤ (Angular `features/carte/panneaux/jeu/`, serveur `lib/zones/`, `app/api/zones/`)

| Brique | Fichiers | État |
|---|---|---|
| Une colonne par plateforme : maille choisie, seuil, rayon, perte chiffrée, lien vers la doc | `panneau-jeu`, `colonne-plateforme` (228 l.), `choix-maille`, `logique/jeu/{conversion,bilan,ecran,mailles-url,plateformes}.ts`, `etat/jeu-zones.service.ts` (**400 l.**) | livré (lot 5, T9-T10) |
| Règles des plateformes en base | `plateformes_geo` (sql/274), 13 lignes, `GET /api/zones/plateformes` | livré ; **6 lignes « à vérifier »** (TTD ×3, Meta CP, TikTok commune et cercle) |
| Conversion : CP, IRIS, commune, département (couverture), cercles (`paver_cercles`), polygone (exact) | sql/275, 276 ; `GET /api/zones/[id]/couverture`, `GET /api/zones/[id]/cercles` | livré |
| Jeu de zone enregistré, extraction immuable | sql/277-279 ; `/api/zones/jeux*` ; `lib/zones/extraction-jeu-zone.ts` | livré ; **une zone pays est refusée à l'extraction** (422, l. 257-259) |
| Carte de ⑤ (zone exacte, unités de la plateforme regardée) | `couches/jeu-carte.service.ts`, `couche-unites.ts` | livré (T11) |
| Bibliothèque, extractions, passerelle ④ → ⑤ | `bibliotheque-jeux`, `extractions-jeu`, `enregistrer-jeu` | livré (T12, T14) |
| Aval : ⑥ rattache une extraction sans CP ; ⑦ un fichier par (plateforme, maille) | `lib/zones/plan-extraction.ts`, `lib/zones/fichiers-plateformes.ts` | livré (lots 6 et 7) ; ⑦ n'a **aucun format** pour une maille hors des six (`formatsDe`, `default: return []`) |

**Tests mesurés le 30/10 (sans pipe) :**
- `npx vitest run --project unit tests/unit/zones tests/unit/angular/taille-fichiers.test.ts` : **14 fichiers, 302 tests verts**, code retour 0 ;
- `npx vitest run --project integration` sur `jeu-zone-extraction`, `jeux-de-zone-routes`, `jeux-de-zone-schema`, `paver-cercles`, `plateformes-geo`, `jeu-risque-caracterisation` : **6 fichiers, 75 tests verts**, code retour 0.

`ng test` et la suite complète n'ont pas été relancés (RAM du poste) : ils se jouent en T6. Les 13 rouges connus de l'Excel n° 49 (dont `activation-extraction` et `fichier-extraction`, jeu de preuve L6-T7 retiré) ne sont pas de ce lot.

**Base locale, 30/10 :** `zone_sets` = 4 jeux, tous de type `risque` ; aucun jeu de zone, aucune unité d'extraction, aucune zone pays en base (supprimés après les preuves). Les tests créent et suppriment leurs propres données.

**Parité React :** ⑤ n'a pas d'équivalent React (le dire en T6). Aucun écart neuf.

### Écarts constatés dans le code et la base

| # | Constat (fichier:ligne, mesure) | Gravité | Tâche |
|---|---|---|---|
| E1 | **Une zone pays passe l'écran de ⑤ et l'enregistrement, puis bute sur l'extraction.** Mesuré sur une zone METRO (transaction annulée) : la couverture CP rend 5 956 CP à 100 % (276 ms, **796 Ko**) ; le découpage par département rend 96 lignes (8,6 ms) ; le découpage par commune est refusé (`decoupage_trop_fin_pays`) ; `paver_cercles` refuse (`zone_trop_vaste`, 547 779 km² pour 100 000 admis). L'écran ne connaît pas la recette `pays` : aucune occurrence de `pays` sous `panneaux/jeu`, `logique/jeu` ou `etat/jeu-zones.service.ts`. Meta, défaut « cercle », affiche « La zone est trop vaste pour ce rayon : augmentez le rayon… », un conseil impossible à suivre (80 km au plus). `POST /api/zones/jeux` accepte le jeu. Seul `extraireJeuZone` refuse, en 422 : « Zone nationale : le ciblage France natif des plateformes arrive avec les finitions de ⑤. » (`lib/zones/extraction-jeu-zone.ts:257-259`). | **Important** (Excel n° 50, P1 ; l'utilisateur règle et enregistre un jeu qu'il ne pourra pas extraire) | T2, T4, Q-1 |
| E2 | **Aucune maille « pays » nulle part.** La contrainte `plateformes_geo_maille_check` n'admet que `polygone, cp, iris, commune, departement, cercle`. `MAILLES` (`lib/zones/plateformes.ts:13`) et sa copie Angular non plus. ⑦ : `formatsDe` rend `[]` pour toute autre maille, donc aucun fichier. | **Important** (sans elle, E1 ne se corrige qu'en convertissant en CP, ce que Q-2 du 30/10 écarte) | T1, T3, T4 |
| E3 | **`etat/jeu-zones.service.ts` fait 400 lignes, au plafond de `taille-fichiers.test.ts`.** Une ligne de plus, et `npm run test:unit` passe au rouge (c'était E5 de ④). | **Important** (préventif : T4 doit toucher ce service) | T0 |
| E4 | Refus `trop_de_cercles` de la RPC sans les chiffres promis par A-8 du lot 5 (« 481 cercles pour 200 admis ») : `MESSAGES_CONVERSION` rend la phrase générique, alors que l'avertissement `max_unites` (`ecran.ts:64`) les dit. Mineur 1 de la preuve T14. | Mineur | T5 |
| E5 | « Mes zones › Jeux de zones » ne relit pas sa liste après un enregistrement en ⑤ : `jeux-de-zones.component.ts:90` lit `JeuxApi.lister()` une fois, au constructeur, sans la `revision` qu'a reçue le sélecteur de ⑤ (`099fe14b`). Mineur 2 de la preuve T14. | Mineur | T5 |
| E6 | La cible et le mode de plan choisis avant l'enregistrement ne sont pas dans l'URL : écart au contrat AIDA n° 5, déclaré au § 17 quinquies (R4 de T9). Un lien partagé rouvre ⑤ sur la cible `ind` et le mode par défaut. | Mineur (écart déclaré) | T5, Q-5 |
| E7 | La population d'un **cercle extrait** est celle de sa CELLULE hexagonale, pas du cercle acheté (sql/276, l. 270-277), et rien ne le dit : `col_description` de `zone_set_extraction_unites.pop_totale` est **vide** (mesuré). ⑦ lit désormais ces unités. Point 20 de la revue finale du lot 5. | Mineur (doc qui manque) | T1 |
| E8 | Les codes de refus SQL ne sont pas verrouillés contre leurs messages (`paver_cercles` ↔ `MESSAGES_CONVERSION`, liste figée à la main dans `conversion.test.ts:116`). La revue finale du lot 5 (point 17) dit : « verrou à écrire au prochain refus ajouté ». Ce lot en ajoute un (`maille_sans_objet`). | Mineur | T2 |
| E9 | Doc qui ment : § 16.1, ligne ⑤, colonne « Ce qui existe » dit encore « jeux de zones Seveso au CP » ; le § 8 ne connaît pas le ciblage pays ; la phrase d'A-5 du plan ④ (« arrive avec les finitions de ⑤ ») est servie par l'export de « Mes zones » (`app/api/custom-geo/[id]/export/route.ts:68`) et `app/api/custom-geo/[id]/route.ts:40`. | Mineur (doc et phrase périmées après ce lot) | T3, T6 |
| E10 | **Les DROM ne sont pas carroyés, sauf deux.** `couverture_pays_jsonb('FR','ind','departement')` rend 98 départements, mais seuls 972 (306 745 hab.) et 974 (884 165 hab.) ont une population ; Guadeloupe, Guyane et Mayotte n'en ont aucune (Filosofi 2021). Une unité « France entière » qui les cite doit dire « population non carroyée », jamais « 0 habitant ». | Mineur (piège à nommer dans T2 et T4) | T2, T4 |
| E11 | L'Excel n° 22 « Filtre par nature des jeux de zones » dit « Sera traité dans ⑤ ». C'est faux : ⑤ n'a aucune notion de nature, et la recette `rayon_poi` de ③ ne porte qu'une `categorie` (`recette-schema.ts:56`). Le filtre relève du moteur risque (`carreau_risque_distance`, prédicat fixe) ou d'une recette de ③. | Décision (ligne de l'Excel à corriger) | Q-6 |
| E12 | Q-A, Q-B et Q-C (spec § 16.7) ne sont toujours pas vérifiés dans de vrais comptes : 6 lignes `a_verifier = true` en base. Rien ne bloque (badge « À vérifier » et lien vers la doc), mais l'Excel n° 29 (exports Meta et TTD) en dépend. | Décision | Q-7 |

### Mesures I/O (base locale, 30/10, lecture seule, transactions annulées)

| Requête | Mesure |
|---|---|
| `zone_pays_geometrie('METRO')` | 47 ms · 547 779 km² |
| `couverture_zone(zone METRO, 'forme')` (la maille `pays` lira ceci) | **4,6 ms** · `population` 62 528 975 · 2 295 034 carreaux comptés par dénominateur, aucun lu |
| `couverture_zone(zone METRO, 'cp')` | 276 ms · 5 956 lignes · jsonb **796 Ko** |
| `couverture_zone(zone METRO, 'departement')` | 8,6 ms · 96 lignes |
| `couverture_pays_jsonb('FR', 'ind', 'departement')` | 11,5 ms · 98 lignes · DROM peuplés : 972, 974 seulement |
| `couverture_zone(zone METRO, 'commune')` | 0,6 ms · refus `decoupage_trop_fin_pays`, aucune lecture |
| `paver_cercles(zone METRO, 80 km)` | 1,8 ms · refus `zone_trop_vaste` (`plafond_km2` 100 000), aucune lecture |

**Mesures portées par les tâches** (avant tout code) :
- T1 : `select * from plateformes_geo` après migration (17 lignes), deux passes de la migration, empreinte `md5(string_agg(...))` identique ;
- T2 : extraction d'un jeu pays, quatre plateformes au pays : cible < 50 ms côté base (une lecture `forme` et une lecture `departement`, aucune autre) ; `EXPLAIN (ANALYZE, BUFFERS)` des deux lectures au rapport.
  - **Mesuré en T2 (30/10, transaction annulée) — ÉCART À LA CIBLE, consigné à la relecture 1 :** « France entière », première lecture : `forme` 4,1 ms · 874 accès + `departement` 5,8 ms · 1 279 accès = **9,9 ms · 2 153 accès, au-dessus de la cible de 2 000 accès** (+ 8 %), sous celle de 50 ms. Gardé : une fois par (zone, cible), puis servi du cache (0,4 ms · 7 accès et 1,0 ms · 13 accès), sans carreau lu. « France métropolitaine » ne lit que la `forme` : 14,9 ms · 1 977 accès à froid, sous la cible.

### Lignes de l'Excel qui touchent ⑤ (relevées, pas entrées d'office)

| N° | Ligne | Place |
|---|---|---|
| 4 | ⑤ Jeu de zones — convertisseur | **fait** (25/10) ; ce lot en est la finition |
| 50 | Mode pays — ⑤ (P1, « S ») | **dans le lot** (T1-T4) |
| 22 | Filtre par nature des jeux de zones (P3) | **hors lot** : la ligne dit « traité dans ⑤ », à corriger (Q-6) |
| 29 | Exports Meta et The Trade Desk (P3) | **hors lot** : dépend de Q-7 (comptes) ; ⑦ fait déjà les fichiers |
| 27 | TikTok — connexion API | **hors lot** (tiers) |
| 32 | Onglets + dossiers versionnés | **hors lot** ; tout l'état neuf reste dans l'URL (E6, Q-5) |
| 39 | Grand nettoyage final | **hors lot** : la duplication « groupe de CP → canonique » (point 14 du lot 5) et `JeuxApi` / `JeuxZonesApi` (point 15) y vont |
| 49 | 13 tests d'intégration liés à des données de preuve | **hors lot** ; à ne pas confondre avec un rouge de ce lot en T6 |
| 7 | ⑧ Live | **hors lot** ; une note au chef de ⑧ (A-8) |

### Numéros SQL (revérifiés le 30/10)

- **Dernier numéro pris : 299** (`ls sql .claude/worktrees/*/sql` et `git ls-tree <branche> sql/` sur toutes les branches : 295-299 dans `feat/carte-finitions` seulement).
- `feat/carte-live` (`9803e320`) n'a **aucun** fichier sql au-delà de 287 ; son plan écrit toujours `sql/288_livraison_plateformes.sql`, déjà pris par `288_indicateurs_privables.sql`. La note « renuméroter à ≥ 300 » est passée au coordinateur le 30/10.
- Ce lot prend **300** (T1). **À revérifier au début de T1** (`ls sql .claude/worktrees/*/sql | grep -E '^3[0-9]{2}_'`). Si ⑧ a pris 300, décaler.

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Forme du mode pays dans ⑤ (Q-1) | Une **maille** `pays` de plus, portée par `plateformes_geo` comme les six autres : une ligne par plateforme, `natif = true`, `disponible = true`, `releve_le = 2026-10-30`, `doc_url` = celle de la ligne CP ou département de la plateforme (TTD : nulle). `a_verifier` : **faux** pour DV360, Meta et TikTok (le ciblage par pays est dans leur doc publique), **vrai** pour TTD (doc derrière connexion, comme ses trois autres lignes). Aucun cas à part dans le code : la maille passe par `exactitude`, `mailleParDefaut`, `verifierLimites`, l'extraction et ⑦ comme les autres. | une table de plus si l'on veut un jour des pays par plateforme hors France |
| A-2 | Les codes pays, en base | Colonne neuve `plateformes_geo.codes_pays jsonb` (nullable, `add column if not exists`, CHECK : objet dont les clés sont `METRO` et `FR` et les valeurs des listes de codes ISO 3166 en majuscules). Seed, sur les quatre lignes `pays` : `{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}`. La note de chaque ligne dit : « Les DROM sont des pays distincts chez la plupart des plateformes : France entière = FR + 5 codes ; à confirmer dans un compte » (Q-2). | une `update` par plateforme, sans livraison |
| A-3 | Quelle maille a un sens pour quelle recette (Review Focus 2) | Fonction pure **`mailleSansObjet(recette, maille): string \| null`** dans `lib/zones/conversion.ts`, recopiée dans `logique/jeu/conversion.ts` sous `conversion-paritaire.test.ts`. Elle rend une phrase, ou `null`. **Zone pays** : `cercle` → « Sur toute la France, le ciblage par cercles n'a pas de sens : choisissez le pays. » ; `commune` et `iris` → la phrase de `decoupage_trop_fin_pays` (`lib/zones/couverture.ts`, réutilisée, pas recopiée). **Zone non pays** : `pays` → `null` côté écran, car la maille n'est pas affichée (Q-4) ; côté serveur, refus « La maille pays ne s'achète que pour une zone nationale. ». `cp`, `departement` et `polygone` restent offerts sur une zone pays (DV360 au CP reste possible, c'est le choix de l'utilisateur, § 16.1). | une ligne de la table |
| A-4 | Exactitude et défaut | `exactitude(recette pays, 'pays')` = `'exacte'`. `FINESSE` gagne `pays` en DERNIER : il n'est jamais le défaut d'une zone non pays. Pour une zone pays, `mailleParDefaut` le choisit d'office : maille exacte d'abord, à `a_verifier` égal. TTD n'a que des lignes à vérifier, donc l'ordre joue entre elles et donne aussi `pays`. Les candidates passent d'abord par `mailleSansObjet` (une maille sans objet n'est jamais le défaut). | une ligne de `FINESSE` |
| A-5 | Ce que la maille `pays` chiffre | `resumeExact(population, surface_km2, n_unites)` : la population et la surface de la couverture « telle quelle » de la zone pays (4,6 ms, aucun carreau lu) ; `n_unites` = le nombre de codes de `codes_pays[code de la recette]`. Zéro perte, taux d'utile 100 %, comme toute maille exacte. Si la plateforme range les DROM dans « FR » (Q-2 « non »), c'est la ligne de la table qui change, pas le calcul. | — |
| A-6 | L'extraction d'une zone pays (Review Focus 3) | `extraireJeuZone` ne refuse plus une zone pays. Pour une plateforme au pays, les unités sont **figées** depuis `codes_pays` : une unité par code, maille `pays`, `retenu = true`, `code` = ISO, `nom` = libellé français (« France », « Guadeloupe »…, une table de 6 libellés dans `lib/zones/conversion.ts`), `pop_en_zone` = `pop_totale` = population carroyée du territoire. Pour `FR`, c'est la métropole, plus chaque DROM par son département (couverture `departement` de la zone, 11,5 ms). La population vaut **`null`**, jamais 0, pour un DROM non carroyé (E10). Le plan CP de l'extraction n'existe que si une plateforme a choisi le CP (règle de sql/278, inchangée). `creer_extraction_jeu_zone` n'est pas touchée. `POST` et `PATCH` d'un jeu refusent en 400 un choix que `mailleSansObjet` refuse, avec sa phrase. | relire `codes_pays` à chaque lecture de l'extraction (pas autoportée) |
| A-7 | ⑦ et la maille `pays` (Q-3) | Format de fichier neuf `pays` : un CSV `code_pays;nom`, avec les lignes `#` de méthode et une ligne de plus, « # Réglage : ciblage par pays, à poser dans la plateforme (aucune liste de lieux à téléverser) ». `formatsDe(·, 'pays')` = `['pays']`. La poussée DV360 par API reste au CP : un jeu DV360 au pays donne le motif existant `aucun_cp_dv360` (« Ce plan ne porte aucun code postal à pousser chez DV360. »), sans code neuf. La phrase d'A-5 du plan ④ (`MESSAGE_ZONE_PAYS_PLATEFORMES`), servie par l'export et le détail de « Mes zones », devient : « Zone nationale : achetez-la à l'étape ⑤ (ciblage par pays des plateformes). ». Le 422 `zone_pays` de ces deux routes reste : un fichier de 48 000 codes n'a pas de sens. | un format à retirer |
| A-8 | ⑥ et ⑧ face à une extraction au pays | **Rien à coder.** ⑥ rattache déjà une extraction sans plan CP (`plan-extraction.ts`, lot 6 T6) ; ses impressions prévues sont par plateforme (spec § 19). Pour ⑧, une **note au chef de ⑧**, sans toucher à sa branche : une extraction au pays a des unités `pays` (FR + DROM) avec leur population. Le « prévu » par région se répartit au prorata de la population, et la descente commence à la région. Via le coordinateur. | une tâche dans ⑧ |
| A-9 | La carte de ⑤ pour la maille `pays` | Le contour de la zone pays seulement (la forme exacte, déjà peinte), sans couche d'unités ni recadrage neuf : `jeu-carte.service.ts` ne peint rien pour `pays`, comme pour `polygone`. | une couche |
| A-10 | `jeu-zones.service.ts` au plafond (E3) | T0 extrait, à comportement constant, la gestion de la liste des tâches (`tache`, `lu`, `surEchec`, `oublierErreur`, `_erreursTaches`) dans `etat/jeu-zones-taches.ts`, au patron de `file-lectures.ts`. Les specs du service ne changent pas. Cible : ≤ 360 lignes. | — |
| A-11 | Ce qu'on garde tel quel | Les points 14 (groupe de CP → canonique écrit deux fois), 15 (`JeuxApi` / `JeuxZonesApi`), 16, 18, 19, 21 et 22 de la revue finale du lot 5 : leur raison y est écrite, et ils vont au nettoyage final (n° 39). Le retour ⑤ → ④ sans couverture repeinte (Q-7 a de ④, gardé le 30/10). Le rayon des cercles à la main (Q-M du lot 5). | — |

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Campagne nationale en ⑤** : pour une zone « France métropolitaine » ou « France entière », chaque plateforme propose d'office **« Pays »**, c'est-à-dire son ciblage France natif, sans liste de codes postaux et sans perte. Les autres choix restent possibles là où ils ont un sens : codes postaux, départements, polygone. Les cercles et les communes sont grisés, avec la raison. | T1-T4 | **[Oui : c'est votre décision du 30/10, et rien d'autre ne change pour les zones locales.]** |
| Q-2 | **« France entière » et l'outre-mer** : la plupart des plateformes traitent la Guadeloupe, la Martinique, la Guyane, La Réunion et Mayotte comme des pays à part. On envoie donc « France + ces 5 codes », marqué « à vérifier » tant qu'on ne l'a pas vu dans un compte. Attention : nos données de population ne couvrent que la Martinique et La Réunion, et l'écran le dira. | A-2, T2 | **[Oui : la liste vit dans la table, une correction ne demande aucune livraison.]** |
| Q-3 | **Activation (⑦) d'une campagne nationale** : il n'y a pas de liste de lieux à téléverser. On fournit un petit fichier par plateforme (« France », plus les DROM si France entière) avec la consigne « à régler dans la plateforme ». La poussée DV360 automatique reste réservée aux codes postaux. | A-7, T3 | **[Oui : la poussée DV360 est encore simulée ; le ciblage pays se règle en deux clics dans chaque plateforme.]** |
| Q-4 | **Le « Pays » pour une zone locale** (par exemple une ville achetée sur toute la France) : on ne le propose pas ? On paierait 99 % de diffusion hors zone. | A-3 | **[Non, on ne le propose pas : une campagne nationale passe par une zone nationale, comme vous l'avez décidé le 25/10.]** |
| Q-5 | **Lien partagé de ⑤** : aujourd'hui, la cible (ex. « 15-29 ans ») et le mode de plan choisis AVANT d'enregistrer ne sont pas dans l'adresse. Un lien envoyé à un collègue rouvre ⑤ sur « tous les habitants ». On les ajoute à l'adresse ? | E6, T5 | **[Oui : petit (≈ 0,15 j), et les futurs onglets / dossiers (n° 32) s'appuient sur l'adresse.]** |
| Q-6 | **Excel n° 22, « Filtre par nature des jeux de zones »** : la ligne dit « traité dans ⑤ ». Ce n'est pas le cas : c'est une façon de dessiner la zone (rayon autour des seuls sites ICPE d'une nature), donc un sujet de ③ ou du module risque. On corrige la ligne, en gardant P3 ? | E11, T6 | **[Oui : corriger la ligne, la rattacher à ③ (« rayon autour des sites ICPE d'une nature »), P3 inchangée.]** |
| Q-7 | **Règles « à vérifier »** : six règles de plateformes restent à confirmer dans de vrais comptes. TTD : polygone, cercles, codes postaux. Meta : codes postaux français. TikTok : communes et arrondissements, cercles. Qui peut regarder, et quand ? Rien ne bloque d'ici là. | E12, Excel n° 29 | **[Un passage de 30 min par compte avec l'équipe trading ; chaque réponse = une mise à jour de la table, sans livraison.]** |

En attendant les réponses, le plan applique les recommandations. Chaque arbitrage dit son coût si la réponse est autre. Une réponse « non » à Q-5 retire sa part de T5 (0,15 j). À Q-3, T3 ne garde que la phrase de « Mes zones » (−0,15 j). Ces retraits n'ont aucun effet sur les autres tâches. Un « non » à Q-1 annule le lot, sauf T0 et T5 : ⑤ convertirait alors une zone pays en CP ou en départements, et seule l'extraction serait débloquée.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `angular/…/carte/etat/jeu-zones.service.ts`, `etat/jeu-zones-taches.ts` (neuf, extrait) | retour sous 400 lignes | T0 |
| `sql/300_maille_pays.sql` (neuf), `lib/zones/plateformes.ts`, `types/database.types.ts` | maille `pays`, `codes_pays`, 4 lignes, commentaire de `pop_totale` (E7) | T1 |
| `lib/zones/conversion.ts`, `lib/zones/extraction-jeu-zone.ts`, `app/api/zones/jeux/route.ts`, `app/api/zones/jeux/[id]/route.ts` (garde du choix), `lib/zones/couverture.ts` (phrase) | `mailleSansObjet`, exactitude, défaut, unités pays, fin du 422 | T2 |
| `lib/zones/fichiers-plateformes.ts`, `app/api/zones/jeux/[id]/extractions/[version]/fichier/route.ts` | format `pays` | T3 |
| `tests/unit/zones/{conversion,extraction-jeu-zone,fichiers-plateformes}.test.ts`, `tests/integration/{plateformes-geo,jeu-zone-extraction}.test.ts`, `tests/unit/angular/conversion-paritaire.test.ts` | T1-T4 | T1-T4 |
| `angular/…/carte/logique/jeu/{plateformes,conversion,ecran,mailles-url}.ts`, `panneaux/jeu/{colonne-plateforme,choix-maille}.component.ts`, `couches/jeu-carte.service.ts`, `etat/jeu-zones.service.ts` | ⑤ au pays | T4 |
| `angular/…/carte/panneaux/zones/jeux-de-zones.component.ts`, `logique/jeu/{ecran,mailles-url}.ts`, `etat/jeu-zones.service.ts` | E4, E5, E6 | T5 |
| `ARCHITECTURE.md`, README carte, spec (§ 16.1 ligne ⑤, § 8, § 17 septies) | docs | T1-T4, T6 |

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- **Racine d'ombre :** jamais `document`, jamais `position: fixed` ; les écouteurs vont sur l'élément du composant. Services d'API dans `FOURNISSEURS_DISTANTS`, adresses par `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- **Signals :** `OnPush`, aucun calcul dans le gabarit. `input()` se lit en fonction (P-d). Un `effect()` qui écrit ce qu'il lit boucle : `untracked()` (P-a).
- **Lectures (P-c) :** toute lecture porte un jeton ; une réponse d'une zone, d'une maille ou d'un espace quittés n'est jamais affichée. **Une maille sans objet ne lance aucune lecture** (Review Focus 1).
- **P-e :** le panneau ⑤ reste MONTÉ ; une couche se retire au `DestroyRef` du service qui l'a posée.
- **P-h :** une réglette ne requête pas à chaque pixel (seuil = calcul local ; rayon = au relâchement).
- **P-i :** un `@for` sur des unités porte un `track` par CODE.
- **MapLibre :** jamais `var()` dans `paint`.
- **Écrivain d'URL unique (P-g) :** `ecrireParametres`. `?mailles=` accepte `dv360.pays` ; une valeur illisible rend les défauts, sans lever.
- **Copies paritaires verrouillées :** `logique/jeu/conversion.ts` ↔ `lib/zones/conversion.ts`, `logique/jeu/plateformes.ts` ↔ `lib/zones/plateformes.ts`. Changer les deux ; `conversion-paritaire` et `activation-paritaire` restent verts.
- **Deux thèmes prouvés ; fichiers sous 400 lignes ; aucune lecture neuve à l'ouverture de ⑤.**

---

## Pré-requis

### Task 0 : `jeu-zones.service.ts` sous le plafond (effort XS, 0,1 j)

- [ ] `wc -l` : 400 constaté. Extraire la gestion des tâches de conversion (A-10) dans `etat/jeu-zones-taches.ts`, à comportement constant ; en-tête qui dit pourquoi (plafond, parenté avec `file-lectures.ts`).
- [ ] `jeu-zones.service.spec.ts` inchangé et vert : `cd angular && npx ng test --watch=false --include='src/app/features/carte/etat/jeu-zones*'`. `npx vitest run --project unit tests/unit/angular/taille-fichiers.test.ts` vert. Codes de retour lus sans pipe.
- [ ] Commit `refactor(angular): ⑤ l'état du jeu redescend sous 400 lignes (⑤ finitions, T0)`.

## Groupe A — serveur (relecture 1)

### Task 1 : la maille `pays` en base (effort S, 0,3 j)

- [ ] Revérifier le numéro libre (300). **Tests d'abord**, dans `tests/integration/plateformes-geo.test.ts` :
  - 17 lignes ; quatre lignes `pays`, `natif` et `disponible` vrais, `a_verifier` vrai pour TTD seulement ;
  - `codes_pays` : `METRO` → `["FR"]`, `FR` → 6 codes ; un `codes_pays` mal formé (clé `XX`, code minuscule) est refusé par le CHECK ;
  - `zone_set_plateformes` accepte `(dv360, pays)` par la clé étrangère ;
  - la migration rejouée ne change rien (empreinte).

  Dans `tests/unit/zones/plateformes.test.ts` (ou le test existant du schéma) : `MAILLES` contient `pays`, et le schéma Zod lit `codes_pays`. FAIL attendu.
- [ ] `sql/300_maille_pays.sql` :
  - la contrainte redéfinie dans un bloc gardé (A-1, patron sql/296 l. 56-75) ;
  - `add column if not exists codes_pays` et son CHECK ;
  - `insert … on conflict (plateforme, maille) do update` des quatre lignes ;
  - `comment on column zone_set_extraction_unites.pop_totale` (E7 : celle de la cellule pour un cercle, du territoire sinon ; `null` = non carroyé).

  Appliquer DEUX fois (`psql -1`). Régénérer `types/database.types.ts` (le diff n'ajoute que la colonne).
- [ ] `lib/zones/plateformes.ts` : `MAILLES` + `codes_pays` dans le schéma et les colonnes lues. `ARCHITECTURE.md` (`Grep "plateformes_geo"`). tsc, unit, integration.
- [ ] Commit `feat(db): maille « pays » des plateformes, codes pays en base (sql/300, ⑤ finitions, T1)`.

### Task 2 : conversion et extraction d'une zone pays (effort M, 0,45 j)

- [ ] **Mesure d'abord** : `EXPLAIN (ANALYZE, BUFFERS)` de `couverture_zone(zone pays, 'forme')` et `('departement')` (METRO puis FR, transaction annulée). Cible : < 50 ms et < 2 000 buffers au total.
- [ ] **Tests d'abord.** Dans `tests/unit/zones/conversion.test.ts` :
  - `mailleSansObjet` : la table d'A-3, cas par cas, dont `pays` sur une zone `rayon_point` ;
  - `exactitude(pays, 'pays')` = exacte ; `mailleParDefaut` donne `pays` aux quatre plateformes pour une zone pays, et ne change pour AUCUNE recette non pays (boucle sur toutes les recettes de `recette-schema`) ;
  - `verifierLimites` sans avertissement ;
  - le verrou E8 : les clés de `MESSAGES_CONVERSION` égalent les refus que sql/276 écrit (`'refus', '…'` lu dans le fichier de migration), et `maille_sans_objet` a sa phrase.

  Dans `tests/unit/zones/extraction-jeu-zone.test.ts` :
  - zone pays, quatre plateformes au pays → unités `pays` figées depuis `codes_pays`, population métropolitaine sur `FR`, `null` sur `GP`, `GF`, `YT` (E10) ;
  - DV360 au CP sur une zone pays → plan CP de 5 956 lignes (sous `PLAFOND_CP_PLAN` 7 000) ;
  - un choix sans objet → 400 avec sa phrase ;
  - plus aucun 422 `zone_pays`.

  Dans `tests/integration/jeu-zone-extraction.test.ts` : un jeu pays créé par le test, extrait, relu après une `update` de `codes_pays` → mêmes unités (Review Focus 3), puis supprimé. FAIL attendu.
- [ ] Implémentation (A-3 à A-6). La garde du choix se pose dans `POST /api/zones/jeux` et `PATCH /api/zones/jeux/[id]`, avant toute écriture. `MESSAGE_ZONE_PAYS_PLATEFORMES` reçoit la phrase d'A-7.
- [ ] `ARCHITECTURE.md` (`Grep "zone_set_extraction_unites"`, `"extraction"`). tsc, unit, integration (dont `jeu-risque-caracterisation`, vert).
- [ ] Commit `feat: ⑤ une zone nationale s'achète au pays, extraction comprise (⑤ finitions, T2)`.

### Task 3 : le fichier « pays » de ⑦ (effort S, 0,25 j — si Q-3 = oui)

- [ ] **Tests d'abord**, dans `tests/unit/zones/fichiers-plateformes.test.ts` :
  - `formatsDe(p, 'pays')` = `['pays']` pour les quatre plateformes ;
  - le CSV porte l'en-tête `code_pays;nom`, les lignes `#` de méthode, la ligne « # Réglage : … » et le badge « À vérifier » pour TTD ;
  - les formats des six autres mailles sont inchangés, octet pour octet (instantanés existants).

  Route `fichier` : `?format=pays` sur une extraction au pays → 200 ; sur une extraction au CP → 400 (phrase existante). FAIL attendu.
- [ ] Implémentation (A-7). `EN_TETES_CSV.pays`. Si `fichiers-plateformes.ts` dépasse 380 lignes, extraire `methodeCsv`.
- [ ] `ARCHITECTURE.md` (`Grep "fichier"`). tsc, unit. Commit `feat(api): ⑦ fichier « pays » d'une extraction nationale (⑤ finitions, T3)`.

**Relecture 1** (T1 à T3, une passe, le modèle le plus capable). Questions :
- Une lecture de carreau part-elle pour une zone pays ?
- `mailleSansObjet` est-elle la seule règle, serveur et écran ?
- Une extraction relue après une `update` de `plateformes_geo` change-t-elle ?
- Une recette non pays voit-elle un seul changement (défaut, exactitude, fichier) ?
- La contrainte redéfinie est-elle rejouable ?
- Le moteur risque est-il vert ?

## Groupe B — Angular (relecture 2)

### Task 4 : ⑤ au pays (effort M, 0,45 j)

- [ ] **Specs d'abord :**
  - `conversion.spec.ts` et `conversion-paritaire.test.ts` : la copie de `mailleSansObjet`, de `FINESSE` et de `exactitude` ;
  - `colonne-plateforme.component.spec.ts` : sur une zone pays, la pastille « Pays » est choisie d'office et affiche « Exacte : aucune perte », la population nationale et les codes (« FR » ou « FR, GP, MQ, GF, RE, YT ») ; cercle et commune sont grisés avec la phrase d'A-3 ; sur une zone non pays, aucune pastille « Pays » ;
  - `jeu-zones.service.spec.ts` : une maille sans objet ne lance AUCUNE lecture (ni couverture ni cercles), et la maille `pays` ne lit que la couverture « telle quelle », une fois par (zone, cible) ;
  - `mailles-url.spec.ts` : `dv360.pays` se lit et s'écrit ; `meta.pays` sur une zone non pays retombe au défaut ;
  - `jeu-carte.service.spec.ts` : `pays` ne pose aucune couche d'unités (A-9) ;
  - un DROM non carroyé s'affiche « population non carroyée » (E10) ;
  - `carte.page.spec.ts` : le compteur réseau de l'ouverture de ⑤ est inchangé.
- [ ] Implémentation. `UNITE_MAILLE.pays` (« pays », « pays », accords) dans `ecran.ts`. Libellé de la pastille : « Pays » (sentence case).
- [ ] ng test (dossiers `carte/{logique/jeu,panneaux/jeu,etat,couches}`), tsc. Commit `feat(angular): ⑤ une zone nationale au ciblage pays des plateformes (⑤ finitions, T4)`.

### Task 5 : les mineurs de la preuve T14, et l'URL (effort S, 0,3 j ; 0,15 j sans Q-5)

- [ ] **Specs d'abord :**
  - E4 : un refus `trop_de_cercles` (corps `{ refus, n_cercles, plafond }`) s'affiche « 481 cercles pour 200 admis par la plateforme : augmentez le rayon ou le seuil. », par la phrase existante de `ecran.ts:64`, sans en écrire une seconde ;
  - E5 : `jeux-de-zones.component` relit sa liste quand `OutilsCarteService.revisionZones()` (ou une révision des jeux, posée par `enregistrer-jeu`) change, au prochain affichage seulement : aucune lecture d'ici là ;
  - E6 (si Q-5 = oui) : `?cibleJeu=` et `?modeJeu=` écrits par `ecrireParametres`, relus au chargement, retirés quand `?jeu=` est posé (le jeu les porte) ; une valeur illisible rend le défaut, sans lever.
- [ ] Implémentation. `mailles-url.ts` porte les deux paramètres. Le § 17 quinquies cesse de déclarer l'écart (T6).
- [ ] ng test, tsc. Commit `fix(angular): ⑤ chiffres du refus des cercles, liste des jeux relue, cible et mode dans l'URL (⑤ finitions, T5)`.

**Relecture 2** (T0, T4, T5). Questions :
- Une lecture part-elle à l'ouverture de ⑤, ou pour une maille sans objet ?
- Une réponse d'une zone quittée peut-elle s'afficher ?
- Une zone non pays est-elle identique à avant ?
- Les copies paritaires sont-elles vertes ?
- Contraste en clair (hors teal, n° 45) ?
- Fichiers sous 400 lignes ?

## Task 6 : revue finale, factorisation, preuve navigateur, docs (effort 0,4 j)

- [ ] **Revue finale** du lot, par le modèle le plus capable : les mineurs accumulés, puis la passe de factorisation (mémoire `feedback_factorisation_fin_de_lot`). Dire ce qui reste dupliqué :
  - `conversion.ts` et `plateformes.ts` le sont par construction et sont verrouillés ;
  - les points 14 et 15 du lot 5 vont au n° 39.
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L5F-T6-*`, captures dans `.superpowers/sdd/2026-10-30-carte-en-parcours-jeu-de-zones/`), sur **:3002 + :4202**, `scripts/local/12-sante.sh` d'abord :
  1. ③ « France métropolitaine » → ⑤ : les quatre colonnes sur « Pays », « Exacte : aucune perte », 62,5 M habitants ; cercles et communes grisés avec leur phrase ; onglet réseau : aucune couverture CP ni cercles lue ;
  2. DV360 basculé sur « Codes postaux » → 5 956 CP à 100 % ; retour sur « Pays » sans relecture ;
  3. enregistrer → extraire → v1 ; ⑦ : fichier « pays » de chaque plateforme ouvert ; DV360 : « aucun code postal à pousser » ;
  4. ③ « France entière » → ⑤ : codes « FR, GP, MQ, GF, RE, YT » ; « population non carroyée » pour GP, GF et YT ;
  5. ⑥ : l'extraction nationale se rattache, impressions prévues par plateforme ;
  6. zone non pays (rayon autour d'un point) : aucune pastille « Pays », défauts inchangés ;
  7. E4 (Meta à 1 km sur la zone composite → « … cercles pour 200 admis ») ; E5 (« Mes zones › Jeux » montre le jeu neuf) ; E6 (lien copié → même cible et même mode).

  Jeux, extractions et zones de preuve supprimés, espace actif rétabli.
- [ ] **Docs :**
  - spec : § 16.1, ligne ⑤, colonne « Ce qui existe » réécrite d'après ce qui existe ; § 8 : une ligne « Pays » ; « § 17 septies — finitions de ⑤ » (décisions Q-1 à Q-7, écarts) ; § 17 quinquies : l'écart E6 levé (si Q-5) ;
  - README carte (§ ⑤) et `ARCHITECTURE.md` ;
  - Excel n° 50 → Fait, n° 4 (finitions), n° 22 corrigée (Q-6) — **au coordinateur, hors du dépôt** ;
  - note au chef de ⑧ (A-8) — **au coordinateur** ;
  - sql/284 rappelée pour le merge.
- [ ] **Tests complets** :
  - `npm test`, `npx tsc --noEmit`, `npm run lint` ;
  - `npm run build`, avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites ;
  - `cd angular && npx ng test --watch=false`, `cd angular && npx ng build`.

  Les 13 rouges connus de l'Excel n° 49 sont nommés, pas confondus avec ce lot.
- [ ] Commit `docs: ⑤ Jeu de zones — revue finale et preuve navigateur (finitions, T6)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| Pré-requis | T0 | 0,1 j |
| A serveur | T1, T2, T3 | 1,0 j (T3 : 0,25 si Q-3) |
| B Angular | T4, T5 | 0,75 j (T5 : 0,3 avec Q-5, 0,15 sans) |
| Fin | T6 | 0,4 j |
| Relectures | 2 | ≈ 0,1 j |
| **Total** | **7 tâches, 2 relectures, 1 preuve** | **≈ 2,35 jours** (≈ 2,2 j sans Q-5 ; le mode pays seul, T0-T4 + T6 : ≈ 2 j) |

L'Excel estimait le n° 50 « S ». Le mode pays est en fait un « M » : une maille de plus traverse ⑤, l'extraction et ⑦, et chaque étage a son test de non-régression pour les zones locales.

T0 ne dépend de rien et peut partir tout de suite. T5 sans Q-5 (E4, E5) aussi.

## Critères de fin du lot

- La suite est verte, dont `taille-fichiers`.
- Une zone « France métropolitaine » ou « France entière » s'achète en ⑤ au pays, sans lire un carreau. Elle s'enregistre, s'extrait, se rattache en ⑥ et donne un fichier par plateforme en ⑦.
- Une maille sans objet ne part jamais. Une zone locale est inchangée.
- Les extractions sont autoportées : les codes pays sont figés à l'extraction.
- Les mineurs E4, E5, E7, E8 sont faits, ainsi que E6 si Q-5 = oui.
- La spec dit ce que ⑤ est (§ 16.1, § 8, § 17 septies).
- React est inchangé, hors deux phrases de routes partagées (A-7).
- Tests et builds verts ; preuve navigateur dans les deux thèmes.

## Hors champ

- Vérification des règles « à vérifier » dans de vrais comptes (Q-7) ; exports Meta et TTD par API (n° 29), connexion TikTok (n° 27).
- Poussée DV360 du ciblage pays par API (la poussée reste au CP, et simulée).
- Rayon automatique des cercles (Q-M du lot 5) ; paliers Meta et TikTok (A-9 du lot 5, registre de sources de poids).
- Filtre par nature (n° 22, Q-6) ; redirection `carte/risques` (A-12 du lot 5).
- Prévu par région d'une extraction nationale dans ⑧ (A-8 : note au chef de ⑧).
- Factorisations différées du lot 5 (points 14 et 15, au n° 39) ; KPI « meilleur taux d'utile » (point 22, question de produit).
- Contraste du teal (n° 45) ; onglets et dossiers (n° 32).
- Application de sql/284 (au merge).
