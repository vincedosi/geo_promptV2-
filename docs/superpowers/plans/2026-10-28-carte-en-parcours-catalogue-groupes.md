# La carte en parcours — lot « Catalogue et groupes » (② Données) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular (pas de port ici, mais ses pièges AIDA valent). Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** 6 tâches en 2 groupes, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (mineurs en T6), **une seule preuve navigateur**, en T6. Cible : **≈ 2,25 jours**.

**Goal :** (1) qu'un **indicateur** puisse devenir privé à un espace (l'abstention → Bercy, V7) avec les MÊMES règles et les MÊMES gestes d'administration que les jeux importés ; (2) une **fiche** par jeu de ② (propriétaire, niveau, effectif, date) ; (3) des **groupes d'espaces** qui rangent la colonne d'Accès en dossiers, sans porter aucun droit (V9).

**Architecture (le moins de code possible) :** on ne crée **pas** de second modèle de droits. Un indicateur privable devient une ligne de `data_sources` (type `indicateur`), et `cible_indicator_registry.data_source_id` pointe dessus. Dès lors `getOrgSourceIds`, `source_visible`, `filtrerParSourcesVisibles`, `getSourcesPropresEspace`, la fiche Socle et l'onglet Données d'Accès (Transférer, Retirer du socle, Partager) s'appliquent aux indicateurs **sans une ligne de règle nouvelle**. Une seule fonction neuve, `indicateursVisibles(req)`, posée dans `lib/auth/perimetre-donnees.ts` et appelée par chaque route qui sert un indicateur. Les groupes sont une colonne texte `organizations.groupe_espace`, lue par Accès seul.

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — § 7.1 (catalogue), § 7.3 (groupes), V6, V7, V8, V9, § 6 (outil « Fiche »), § 12 lot 8 = § 16.5 lot 11 « inchangé ». Les §§ 16-19 ne touchent pas ce lot (ils portent sur ③-⑧ et les onglets) ; § 18 : ② vit dans l'onglet Insights, sans effet ici. § 7.2 (sélection recommandée) est **déjà livrée** (lot 2, sql/251, `jeux-recommandes.component.ts`) : hors de ce plan. Specs voisines : `2026-10-08-espaces-de-travail-design.md`, `2026-10-12-droits-sur-la-carte-design.md`.

## Global Constraints

- **Aucune modification React.** Les routes changent pour tous leurs appelants : React reçoit simplement un catalogue filtré (écart listé en T6).
- **Une recommandation ou un groupe n'ouvre aucun droit** ; un indicateur privé est **invisible** hors de son espace et de ses partages, super_admin compris sur la carte (il voit comme l'espace choisi, R3/R4 du 12/10).
- Un indicateur refusé se répond **comme un indicateur inconnu** (même statut, même message) : on ne révèle pas qu'il existe.
- **Aucune donnée de démo.** La seule ligne écrite par migration est l'entrée de catalogue d'un jeu réel (l'abstention, au socle). Le passage à Bercy se fait par l'écran d'Accès, en preuve (Q-3).
- Effectifs : `data_sources.valid_count`, jamais de `COUNT` sur `poi_france` (§ 7.1).
- Routes : `force-dynamic`, Zod, `lireCorps()`, `getSession` sur `/api/*`, `createAdminClient()`, erreurs supabase-js lues.
- Migrations additives, rejouables, base locale seulement ; aucun `DROP FUNCTION`. Seule exception : remplacer la contrainte `data_sources_type_check` (un `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` dans la même instruction, rejouable, données intactes).
- Fichiers `.ts` < 400 lignes : `panneau-donnees.component.ts` est à **352/400** — la fiche vit dans un composant à part.
- Textes en sentence case, vouvoiement, jetons `var(--…)` seulement (côté admin : `var(--teal-texte)` etc. pour du TEXTE coloré), Inter + JetBrains Mono, bordures 0,5 px.
- Preuve sur **:3002 / :4202** (serveurs du worktree), jamais :3000 / :4200.

## Review Focus

1. **Fuite d'un indicateur privé** : abstention privée à Bercy → depuis BMW GROUP, aucune des routes de T2 ne la rend, ne la calcule ni ne la nomme (catalogue, couche civique, aperçu de seuil, score, corrélation, zone par seuil — création, aperçu ET recalcul). Test d'intégration d'accès croisé en T2 ; preuve onglet réseau en T6.
2. **Retour silencieux au socle** : supprimer la source d'un indicateur ne doit jamais le rendre public. FK `on delete restrict` + `DELETE /api/admin/sources/[id]` répond 409 pour le type `indicateur` (T1).
3. **Faux import** : la ligne `data_sources` de l'abstention n'apparaît pas dans Données › Historique (ce n'est pas un import) mais apparaît dans Accès (c'est un jeu) (T1).
4. **Le groupe ne porte rien** : aucune route hors `app/api/admin` et `lib/espaces` ne lit `groupe_espace` — test de verrou (T3).
5. **② sans l'abstention** : dans un espace qui ne la voit pas, la ligne « Indicateurs au code postal » disparaît (elle n'affiche que l'abstention) ; chez Bercy elle se range dans « Données de l'espace » (T5).

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 28/10, worktree `carte-finitions`, HEAD `20fbee8b`)

### Mesures en base locale (28/10)

| Objet | Mesure | Conséquence |
|---|---|---|
| `data_sources` | **7 lignes** (2 socle, 5 privées) ; lecture filtrée par catégorie + visibilité : 1 buffer, 0,14 ms | une lecture de plus par appel d'indicateur est négligeable |
| `cible_indicator_registry` | **19 lignes** actives (16 `iris_column`, `abstention`, `pollen`, `atmo`) ; lecture complète 1 buffer, 0,21 ms | filtrage en mémoire sans coût |
| `iris_indicator_registry` | 51 lignes (colonnes IRIS importées) | hors lot (Q-2) |
| `dataset_abstention_2022` / `indicator_cp_values` (abstention) | **6 186 CP** chacun | effectif de la fiche, écrit dans `valid_count` |
| `organizations` | **5 espaces** (Bercy, BMW GROUP, DRHAT, GENESIS (Global), Marine nationale) ; colonne `config jsonb` vide partout | groupes utiles plus tard, coût faible maintenant |
| `poi_categories` | 9 catégories ; `poi_france` ≈ 390 000 lignes, 5 catégories présentes | la fiche d'un type de POI lit `data_sources` par `category`, jamais `poi_france` |
| Numéros SQL | dernier `287` dans tous les worktrees ; **288 et 289 libres** au 28/10 | à revérifier au moment de T1/T3 |

### Le modèle de droits actuel (aucun changement de règle dans ce lot)

- `lib/auth/getOrgSourceIds.ts` : socle + sources de l'espace + `shared_with` ; jumelle SQL `source_visible` (sql/234). `vueEspace: true` sur la carte.
- `lib/auth/perimetre-donnees.ts` : `sourcesVisiblesDeLaRequete(req)`, `filtrerParSourcesVisibles(q, sources, { referentiels })` — filtre sur la colonne **`data_source_id`**, `referentiels: true` garde les lignes sans source. **C'est exactement la forme voulue pour le registre** si sa colonne s'appelle `data_source_id`.
- `getSourcesPropresEspace(session)` : les sources privées de l'espace (possédées ou partagées) → rangement « Données de l'espace ».
- `tests/unit/securite/perimetre-routes.test.ts` : toute route qui lit une table client doit importer la règle ; la regex `LECTURE_CLIENT` liste les tables/RPC.

### Qui sert un indicateur aujourd'hui (toutes sans contrôle d'espace)

| Route | Lecture | Appelants |
|---|---|---|
| `GET /api/cibles/indicators` | registre entier | Angular `CatalogueIndicateursService` (une fois par page), React wizard `StepCible`, `ScoreCompositeTool`, `CorrelationTool` |
| `GET /api/insee-variables/[code]/geojson` | RPC `get_civic_layer_geojson` (= `dataset_abstention_2022`) | couche civique Angular et React |
| `GET /api/cibles/preview`, `POST /api/custom-geo/source/indicator-threshold` | RPC `get_indicator_threshold_selection` | React (et ③ « Par seuil » via recette) |
| `POST /api/analyses/score`, `POST /api/analyses/correlation`, `POST /api/custom-geo/source/score` | registre + `assurerIndicateurCp` + `calculer_score_composite_jsonb` | ④ Angular, React |
| Recette `seuil_territoire` (`lib/zones/executer-recette.ts` → RPC `zone_seuil_territoire`) | `indicator_cp_values` | `POST /api/zones`, `/api/zones/apercu`, recalcul de zone |
| `app/api/bidding/strategies/*`, `campaigns/[campaignId]/alignement/maille/map` (repli `abstention_pres_2022`), `zones/jeux/[id]/rattacher` | registre / matérialisation | React wizard et suivi, ⑥ |

### Côté Angular

- Accès : `features/admin/espaces/` — `espaces.page.ts` (240 l., colonne), `fiche-socle.component.ts` (310), `onglet-donnees.component.ts` (344, gestes Transférer / Mettre au socle / Partager / Retirer), `onglet-reglages.component.{ts,html}` (249), `logique/libelles.ts` (`LIBELLES_TYPE` : poi, panneaux, carreaux), `logique/types.ts` (`TypeJeu`).
- ② : `carte/panneaux/donnees/panneau-donnees.component.ts` (352), `ligne-jeu.component.ts` (64), `logique/rangement-jeux.ts` (`jeuxDeLaCarte`, `rangerJeux`), `logique/jeux-carte.ts` (copie paritaire de `lib/carte/jeux-carte.ts`, `toEqual` dans `tests/unit/angular/jeux-carte-paritaire.test.ts`), `etat/catalogue-indicateurs.service.ts` (fourni par `CartePage`).
- Boîte à outils : `outils/boite-outils.component.ts` (`OUTILS` : analyses, zones, fond, légende, aide, réglages) — pas d'outil « Fiche » aujourd'hui.

### Écarts à la spec (tranchés, Q-1/Q-4/Q-5)

| Spec | Ce plan | Pourquoi |
|---|---|---|
| Table `catalogue_jeux` (une ligne par jeu, POI ET indicateurs ET référentiels) | **Pas de table** : POI et indicateurs privables = `data_sources` ; référentiels = registre statique `JEUX_REFERENTIELS` ; la fiche se compose à la lecture | un seul endroit de vérité (la spec le demande déjà pour les jeux à source), zéro second modèle de droits, zéro nouvel écran d'admin |
| Édition dans une « page Données de l'admin pour le catalogue entier » | **Fiche Socle + onglet Données d'Accès, existants** | les gestes existent déjà pour `data_sources` |
| Outil « Fiche » dans la boîte à outils | **Fiche dépliée sous la ligne de ②** (bouton « i ») | pas de tiroir de plus, pas de largeur de bord droit de plus |
| Table `groupes_espaces (id, nom)` + `organizations.groupe_id` | **Colonne texte `organizations.groupe_espace`** | le groupe ne porte rien : un nom suffit ; aucun écran de gestion des groupes |

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Indicateurs privables | Un indicateur l'est s'il a `data_source_id`. La migration ne l'écrit que pour **`abstention_pres_2022`**. Les 16 `iris_column` restent sans source : leur colonne est lisible par les tuiles IRIS, les rendre « privés » serait une fausse promesse. `pollen`, `atmo` : donnée publique servie en direct par la couche santé. Un test d'intégration échoue si un `iris_column` reçoit une source. | une ligne de migration par indicateur ajouté |
| A-2 | Ligne `data_sources` de l'abstention | `type 'indicateur'`, `category = 'abstention_pres_2022'`, `name 'Taux d'abstention (présidentielle 2022)'`, `visibilite 'socle'`, propriétaire GENESIS (Global) (défaut de la colonne), `valid_count 6186` (mesuré), `status 'active'`, `metadata { origine: 'Ministère de l'Intérieur (data.gouv.fr)' }` (en-tête de `scripts/import_abstention_2022.ts`) ; insertion idempotente (`where not exists` sur `type, category`). | un `update` |
| A-3 | Suppression | FK `cible_indicator_registry.data_source_id → data_sources(id) on delete restrict` ; `DELETE /api/admin/sources/[id]` répond **409** « Un indicateur ne se supprime pas : rendez-le au socle ou transférez-le. » pour le type `indicateur`, avant toute écriture. | — |
| A-4 | Historique des imports | `GET /api/admin/imports` exclut `type = 'indicateur'` (ce n'est pas un import). La liste de `/api/admin/sources` le garde (c'est une source), avec le libellé « Indicateur ». | une condition |
| A-5 | La fonction unique | `indicateursVisibles(req): Promise<{ visibles: Set<string>; propres: Set<string> }>` dans `perimetre-donnees.ts` : `sourcesVisiblesDeLaRequete` + registre filtré par `filtrerParSourcesVisibles(…, { referentiels: true })` ; `propres` = codes dont la source ∈ `getSourcesPropresEspace`. Échec de lecture → ensembles vides (ferme). Chaque route : `if (!visibles.has(code)) → réponse « indicateur inconnu » existante`. | — |
| A-6 | `GET /api/cibles/indicators` | rend les seuls indicateurs visibles, chacun avec `origine: 'espace' \| 'commune'` (champ ajouté ; React l'ignore). | — |
| A-7 | ② et la ligne civique | `JeuReferentiel` gagne `indicateurs?: readonly string[]` (les deux copies) ; `civique:indicateurs-cp` porte `['abstention_pres_2022']`. `jeuxDeLaCarte(types, indicateurs)` retire un référentiel dont AUCUN indicateur n'est visible et le range « espace » si l'un est propre. Avant l'arrivée du catalogue : la ligne reste (comportement actuel), pour ne pas faire clignoter ②. | deux lignes |
| A-8 | Fiche | `GET /api/map/catalogue/fiche?cle=` lue **à l'ouverture** seulement, cache par clé dans le composant. `poi:<cat>` → sources visibles de catégorie `cat` : nom, propriétaire, niveau (socle / privé / partagé, vu de l'espace actif), effectif `valid_count`, date d'import. Référentiel → « Socle dentsu.explore, référentiel système » + les sources de ses `indicateurs` visibles. Clé inconnue ou invisible → 404. Pas de provenance ni de millésime pour les référentiels sans source (Données › Fraîcheur les montre). | un champ `provenance` au registre |
| A-9 | Groupes | `organizations.groupe_espace text null check (char_length(btrim(groupe_espace)) between 1 and 60)`. `GET admin/espaces` le rend ; `PATCH /api/admin/organizations/[id]` l'accepte (`string` rognée 1-60 ou `null`). Colonne d'Accès : espaces sans groupe d'abord, puis un dossier repliable par groupe (ordre alphabétique), état de repli non persistant. Réglages de l'espace : champ « Groupe » avec suggestions (`<datalist>` des groupes existants). Le sélecteur d'espace du shell n'est pas touché. | une table si les groupes doivent porter autre chose qu'un nom |

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Pour rendre un indicateur privé, on le traite comme un jeu importé** (il apparaît dans Accès › Socle et dans l'onglet Données de l'espace, avec les mêmes boutons « Transférer », « Retirer du socle », « Partager »), plutôt que de créer un nouveau catalogue avec son propre écran. D'accord ? | A-1 à A-6, T1-T2 | **[Oui : aucun nouvel écran, une seule règle de droits.]** |
| Q-2 | **Quels indicateurs peuvent devenir privés ?** Les 16 indicateurs INSEE des IRIS restent lisibles dans la couche IRIS de la carte : les dire « privés » serait faux. | A-1 | **[L'abstention seule pour l'instant ; on en ajoute un autre en une ligne quand un client apporte sa donnée.]** |
| Q-3 | **Après la preuve, l'abstention reste-t-elle privée à Bercy ?** BMW, la Marine et DRHAT ne la verront plus (ni dans la couche civique, ni dans le score, ni dans les zones « par seuil »). | T6 | **[Oui, c'est la décision V7.]** |
| Q-4 | **La fiche d'un jeu s'ouvre sous sa ligne, à l'étape ② (petit bouton « i »)**, plutôt que dans un nouvel outil « Fiche » de la boîte à outils. D'accord ? | A-8, T5 | **[Oui : moins de code, la fiche reste à côté du jeu.]** |
| Q-5 | **Un groupe d'espaces est un simple nom saisi dans les Réglages de chaque espace** (avec suggestions), sans écran de gestion des groupes. Renommer un groupe = le changer dans chacun de ses espaces. D'accord ? | A-9, T3-T4 | **[Oui : 5 espaces aujourd'hui, le groupe ne porte rien.]** |

En attendant les réponses, le plan applique les recommandations ; chaque arbitrage dit son coût si la réponse est autre.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/288_indicateurs_privables.sql` (neuf) | type `indicateur`, `cible_indicator_registry.data_source_id`, ligne de l'abstention | T1 |
| `lib/espaces/types.ts`, `app/api/admin/sources/[id]/route.ts`, `app/api/admin/imports/route.ts`, `types/database.types.ts` | type `indicateur`, 409, exclusion de l'historique | T1 |
| `lib/auth/perimetre-donnees.ts` | `indicateursVisibles` | T2 |
| les routes du tableau « Qui sert un indicateur » | appel de la règle | T2 |
| `tests/unit/securite/perimetre-routes.test.ts` | regex étendue aux tables et RPC d'indicateurs | T2 |
| `tests/integration/indicateurs-privables.test.ts` (neuf) | schéma (T1), accès croisé (T2) | T1, T2 |
| `app/api/map/catalogue/fiche/route.ts` + `lib/carte/fiche-jeu.ts` (neufs) | fiche d'un jeu (composition pure testée à part) | T3 |
| `sql/289_groupes_espaces.sql` (neuf), `lib/espaces/lister-espaces.ts`, `lib/espaces/types.ts`, `app/api/admin/organizations/[id]/route.ts` | groupes | T3 |
| `tests/unit/espaces/groupe-ne-porte-rien.test.ts` (neuf) | verrou `groupe_espace` hors admin | T3 |
| `angular/…/admin/espaces/{espaces.page.ts, onglet-reglages.component.{ts,html}, logique/types.ts, logique/libelles.ts, data/espaces.api.ts}` (+ specs) | dossiers, champ Groupe, libellé « Indicateur » | T4 |
| `lib/carte/jeux-carte.ts` + `angular/…/carte/logique/jeux-carte.ts` | champ `indicateurs` | T5 |
| `angular/…/carte/{logique/rangement-jeux.ts, panneaux/donnees/panneau-donnees.component.ts, panneaux/donnees/ligne-jeu.component.ts, panneaux/donnees/fiche-jeu.component.ts (neuf), data/…api.ts, logique/analyses/score.ts}` (+ specs) | ② rangé par les droits, fiche | T5 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | doc dans le commit de chaque tâche serveur, puis T6 | T1-T3, T6 |

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Racine d'ombre : jamais `document`, jamais `position: fixed` ; écouteurs sur l'élément du composant.
- Liens relatifs, état partageable dans l'URL (ici : rien de neuf à mettre dans l'URL — fiche et dossiers repliés sont de l'état d'affichage).
- Signals, `OnPush`, aucun calcul dans le gabarit ; `input()` réactif ; abandonner la lecture en vol au changement d'entrée.
- Deux thèmes prouvés ; texte coloré dans l'admin par `--teal-texte` / `--success-texte`.
- Fichiers < 400 lignes ; parité `jeux-carte` verrouillée (`toEqual`).
- Aucun préchargement : la fiche ne lit rien tant qu'elle n'est pas ouverte.

---

## Groupe A — serveur (relecture 1)

### Task 1 : l'indicateur devient un jeu (effort S-M, 0,35 j)

- [ ] Tests d'abord : `tests/integration/indicateurs-privables.test.ts` (partie schéma) — la ligne `data_sources` de l'abstention existe une fois (type `indicateur`, socle, `valid_count = 6186`) et le registre y pointe ; aucun `iris_column` n'a de `data_source_id` (A-1) ; `DELETE /api/admin/sources/<abstention>` → 409, ligne intacte ; `GET /api/admin/imports` ne la rend pas, `GET admin/espaces/socle` la rend avec `type: 'indicateur'`. FAIL attendu.
- [ ] `sql/288_indicateurs_privables.sql` : contrainte `data_sources_type_check` remplacée (`… 'carreaux', 'indicateur'`), `alter table cible_indicator_registry add column if not exists data_source_id uuid references data_sources(id) on delete restrict`, index partiel, insertion idempotente (A-2), `update` du registre, `comment on`. Appliquer en local ; relire `\d` ; rejouer une 2ᵉ fois sans effet.
- [ ] `TypeJeu` += `'indicateur'` (serveur) ; `DELETE` 409 (A-3) ; historique (A-4) ; `grep -rn "type === '\|\.eq('type'" app lib` sur `data_sources` pour vérifier qu'aucun lecteur ne casse sur le nouveau type (sources Angular : panneaux par type) — noter le résultat dans le rapport.
- [ ] `ARCHITECTURE.md` (`Grep "data_sources"`, `"cible_indicator_registry"`) ; `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [ ] Commit `feat(db): un indicateur peut devenir un jeu de données (catalogue, T1)`.

### Task 2 : une seule règle pour tout indicateur servi (effort M, 0,5 j)

- [ ] Tests d'abord : `perimetre-routes.test.ts` — `LECTURE_CLIENT` gagne `cible_indicator_registry`, `indicator_cp_values`, `dataset_abstention_2022`, et les RPC `get_civic_layer_geojson`, `get_indicator_threshold_selection`, `calculer_score_composite[a-z_]*`, `materialize_indicator_cp_values`, `etat_indicateur_cp`, `zone_seuil_territoire`, `alignement_par_maille_geo` → le test liste les fichiers à brancher (FAIL). Intégration (accès croisé, dans une transaction de test qui rend l'abstention privée à Bercy puis la remet au socle dans un `finally`) : session BMW → `cibles/indicators` sans l'abstention, `insee-variables/abstention_pres_2022/geojson` 404, `analyses/score` et `analyses/correlation` « indicateur inconnu », `zones/apercu` recette `seuil_territoire` sur l'abstention refusée ; session Bercy → présente, `origine: 'espace'` ; super_admin en espace BMW → comme BMW.
- [ ] `indicateursVisibles` (A-5) ; brancher chaque route du tableau du pré-vol (la recette `seuil_territoire` : contrôle dans les routes qui appellent `executerRecette` — création, aperçu, recalcul —, pas dans la RPC) ; `cibles/indicators` rend `origine` (A-6) ; `alignement/maille/map` : repli `abstention_pres_2022` invisible → « aucune variable », jamais une erreur. Une route réservée au super_admin HORS carte peut être inscrite dans `ASSUMEES` avec sa justification écrite, pas oubliée.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` des deux lectures ajoutées (sources visibles, registre filtré) — chiffres dans le rapport.
- [ ] `ARCHITECTURE.md` (`Grep "cibles/indicators"`, `"perimetre-donnees"`) ; tsc, unit, integration.
- [ ] Commit `feat(api): les indicateurs suivent les droits de l'espace (catalogue, T2)`.

### Task 3 : fiche d'un jeu et groupes d'espaces, côté serveur (effort S-M, 0,35 j)

- [ ] Tests d'abord : `tests/unit/carte/fiche-jeu.test.ts` (composition pure : POI socle / privé / partagé vu de l'espace actif, référentiel sans source, référentiel lié à un indicateur visible / invisible, clé inconnue) ; `tests/unit/espaces/groupe-ne-porte-rien.test.ts` (aucun fichier de `app/` hors `app/api/admin`, ni de `lib/` hors `lib/espaces`, ni d'`angular/src/app/features/carte` ne mentionne `groupe_espace`) ; intégration : `PATCH` groupe « Armées » → `GET admin/espaces` le rend, `null` l'efface, 61 caractères → 400.
- [ ] `app/api/map/catalogue/fiche/route.ts` (A-8) — publique comme `/api/map/categories` si elle ne lit rien sans espace, sinon `getSession` ; inscrite dans `tests/unit/api/routes-publiques.test.ts` selon le cas.
- [ ] `sql/289_groupes_espaces.sql` (A-9), lecture et écriture (A-9). Appliquer en local.
- [ ] `ARCHITECTURE.md` (route neuve, colonne) ; tsc, unit, integration.
- [ ] Commit `feat(api): fiche d'un jeu de la carte et groupes d'espaces (catalogue, T3)`.

## Groupe B — Angular (relecture 2)

### Task 4 : Accès — dossiers de groupes, champ Groupe, libellé Indicateur (effort S, 0,3 j)

- [ ] Specs d'abord : colonne d'Accès — espaces sans groupe, puis dossiers « BMW » / « Armées » repliables (bouton `aria-expanded`), navigation clavier haut/bas conservée à travers les dossiers ouverts, un dossier contenant l'espace sélectionné s'ouvre ; Réglages — champ « Groupe » prérempli, suggestions = groupes des autres espaces, vide → `null`, enregistrement par le bouton existant ; fiche Socle et onglet Données — une ligne `indicateur` affiche « Indicateur » et offre les mêmes gestes qu'un POI.
- [ ] Implémentation dans les fichiers listés ; aucun appel de plus au montage (le groupe arrive dans `GET admin/espaces`).
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit -p angular`.
- [ ] Commit `feat(angular): Accès range les espaces par groupe (catalogue, T4)`.

### Task 5 : ② rangé par les droits, fiche d'un jeu (effort M, 0,4 j)

- [ ] Specs d'abord : `rangement-jeux` (A-7 : référentiel retiré si aucun indicateur visible, rangé « espace » si propre, inchangé tant que le catalogue n'est pas arrivé) ; `fiche-jeu.component` (aucune lecture fermée ; une lecture à la 1ʳᵉ ouverture, aucune à la 2ᵉ ; 404 → « Ce jeu n'est plus disponible dans cet espace. » ; échec → message et « Réessayer ») ; `ligne-jeu` (bouton « i » `aria-expanded`, `aria-controls`, libellé « Fiche du jeu <nom> ») ; parité `jeux-carte`.
- [ ] Implémentation : champ `indicateurs` (deux copies), `jeuxDeLaCarte(types, indicateurs)`, `panneau-donnees` lit `CatalogueIndicateursService` (déjà fourni par la page, aucune lecture de plus), `fiche-jeu.component.ts` neuf, méthode d'API. Contenu de la fiche : « Propriétaire · Niveau · Effectif · Importé le », une ligne par source ; chiffres par `formaterNombre`, dates en `fr-FR`.
- [ ] ng test, tsc ; `panneau-donnees.component.ts` toujours < 400 lignes.
- [ ] Commit `feat(angular): ② range les indicateurs par droits et montre la fiche d'un jeu (catalogue, T5)`.

## Task 6 : revue finale, factorisation, preuve navigateur (effort 0,35 j)

- [ ] Revue finale du lot (modèle le plus capable) : mineurs accumulés, passe de factorisation inter-tâches (dire ce qui reste dupliqué : `TypeJeu` et `JEUX_REFERENTIELS`, dupliqués par construction React/Angular et verrouillés par parité).
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L-CAT-T6-*`), sur **:3002 + :4202** : Accès › Socle → l'abstention « Indicateur » ; « Retirer du socle » puis, dans GENESIS (Global) › Données, « Transférer… » à Bercy ; carte en BMW GROUP : ② sans « Indicateurs au code postal », ④ score sans l'abstention, onglet réseau : `insee-variables/abstention_pres_2022/geojson` jamais appelé (ou 404 si forcé à la main) ; carte en Bercy : la ligne dans « Données de l'espace », fiche « Bercy · Privé · 6 186 · importé le … », couche affichée ; fiche d'un type de POI commun (lycées) et d'un POI privé (CIRFA, en Marine nationale) ; Accès : groupe « Armées » posé sur Marine nationale et DRHAT → dossier dans la colonne, puis **retiré** (aucune donnée de démo laissée, sauf si Vincent garde le groupe). L'abstention reste à Bercy selon Q-3, sinon remise au socle.
- [ ] Écart React à lister : React reçoit le catalogue filtré ; sa couche civique affiche son état d'erreur dans un espace qui ne voit pas l'abstention (fichier gelé, non modifié).
- [ ] `ARCHITECTURE.md` (catalogue, groupes, fiche), `angular/src/app/features/carte/README.md` (§ ②). Tests complets : `npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run lint`, `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites, `cd angular && npx ng build`.
- [ ] Commit `docs: catalogue et groupes — revue finale et preuve navigateur (T6)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A serveur | T1, T2, T3 | 1,2 j (T2 touche ≈ 12 routes, une ligne de contrôle chacune, et porte le test d'accès croisé) |
| B Angular | T4, T5 | 0,7 j |
| Fin | T6 | 0,35 j |
| **Total** | **6 tâches, 2 relectures, 1 preuve** | **≈ 2,25 jours** |

## Critères de fin du lot

Un super_admin rend l'abstention privée à Bercy depuis Accès, avec les gestes existants ; depuis tout autre espace (super_admin compris), aucune route ne la rend, ne la calcule ni ne la nomme, et ② ne propose plus la ligne civique ; chez Bercy, elle est dans « Données de l'espace » ; chaque jeu de ② a une fiche lue à la demande ; la colonne d'Accès range les espaces par groupe et aucune règle de droit ne lit le groupe ; aucune table de catalogue ni de groupe créée ; React inchangé hors l'écart listé ; tests et builds verts ; preuve navigateur dans les deux thèmes.

## Hors champ

Privatisation des 16 indicateurs IRIS, de `iris_indicator_registry`, des référentiels (carreaux, transport, ICPE, TMJA, santé, météo) ; provenance et millésime des référentiels dans la fiche ; groupe affiché dans le sélecteur d'espace du shell ; écran de gestion des groupes ; outil « Fiche » dans la boîte à outils ; toute modification de la sélection recommandée (§ 7.2, livrée au lot 2).
