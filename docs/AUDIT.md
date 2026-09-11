# Audit — 2026-09-11

> Phase 2 de `/audit-refactor`. Chaque constat est cité en `fichier:ligne` et a
> été vérifié dans le code. Ce qui n'a pas été vérifié ne figure pas ici.
>
> Seuils : ceux du projet priment sur ceux de la grille. `docs/known_tech_debt.md`
> travaille avec **1 000 lignes par fichier** (et non 300), et `CLAUDE.md` fixe
> les règles d'I/O (3 appels Supabase parallèles max, batch de 50, bbox viewport).

## Synthèse

| Gravité | Nombre |
|---|---|
| Critique | 2 |
| Haute | 8 |
| Moyenne | 8 |
| Basse | 4 |

**Baseline de qualité, mesurée** : `npx tsc --noEmit` **0 erreur**,
`npm run lint` **0 warning**, **483 tests verts** sur 64 fichiers.
`npm audit` : 2 critiques, 8 hautes, 7 moyennes, 6 basses.

La conclusion principale de cet audit est qu'**il n'y a pas de dette de forme**.
L'hygiène de typage et de lint est irréprochable, les couches sont respectées,
la clé `service_role` ne fuit nulle part, il n'y a ni secret en dur, ni IDOR, ni
injection SQL, et les whitelists SSRF sont correctes. Un refactor cosmétique
n'apporterait rien.

**La dette est dans les comportements aux limites** : ce qui se passe quand on
rejoue un import, quand un appel externe ne répond pas, quand une erreur
survient, quand le volume monte.

## Top 5 des zones critiques

1. ~~**Import de POI non idempotent** — un rejeu duplique l'intégralité des
   données.~~ `ECH-001` — **corrigé le 2026-09-11**, voir ci-dessous.
2. **`/api/admin/iris/stats` reproduit le motif de l'incident du 28/03** —
   21 `count(exact)` sur 51 000 lignes par appel. `PERF-001`
3. **La protection des routes repose sur deux listes à synchroniser à la main** —
   un oubli rendrait une route publique en silence. **Aucun trou aujourd'hui**,
   vérifié, et désormais verrouillé par un test. `ARC-001`
4. **138 `catch` avalent leur erreur**, dont un `DROP TABLE` raté qui laisse
   continuer la suppression, et cinq actions d'administration qui échouent sans
   rien dire à l'utilisateur. `MAINT-001`
5. **13 appels externes sans délai d'expiration ni reprise** vers Google,
   TikTok et Modal. `ECH-002`

---

## Constats

### ECH-001 [Échelle] Rejeu d'un import de POI : duplication totale
- **Localisation** : `lib/import/validator.ts:196` et `lib/import/inserter.ts:65`
- **Constat** : `validator.ts` pose `id: randomUUID()` à chaque parse.
  `inserter.ts` fait `.upsert(row, { onConflict: 'id', ignoreDuplicates: true })`.
  L'identifiant étant neuf à chaque exécution, **le conflit ne peut jamais se
  produire** et `ignoreDuplicates` n'a aucun effet.
- **Impact** : rejouer le même fichier — reprise après erreur réseau, double
  clic, relance après échec partiel — duplique tous les POI. Aucune erreur,
  aucune alerte : la base grossit et les analyses géographiques comptent double.
- **Gravité** : critique
- **Effort** : M
- **Corrigé le 2026-09-11** (`lib/import/identite-poi.ts`) : l'identifiant
  devient une empreinte UUIDv5 du contenu de la ligne — source, catégorie, nom,
  adresse, code postal, ville, latitude, longitude — normalisé (`trim`,
  minuscules, NFC, coordonnées à 6 décimales). Le même fichier produit toujours
  les mêmes identifiants, donc `onConflict: 'id'` se déclenche enfin et le rejeu
  devient une opération nulle. Aucune migration, aucune contrainte ajoutée : la
  clé primaire `id` et le `onConflict` existaient déjà, il leur manquait un
  identifiant reproductible.
  - **Pourquoi pas une contrainte `UNIQUE` sur la clé métier**, comme
    `panneaux_affichage (source, source_ref)` : `poi_france` n'a **pas** de
    colonne `source_ref` (les fichiers importés n'apportent aucun identifiant
    externe), et **358 des 290 877 lignes sont déjà en doublon** — la contrainte
    échouerait à la pose, et supprimer ces lignes serait une destruction de
    données, pas un correctif.
  - **Limite connue** : les 290 877 POI existants portent des identifiants
    aléatoires. Le premier ré-import d'un fichier déjà importé créera donc
    encore une dernière série de doublons ; il devient idempotent à partir de
    là.
  - **Portée** : les DEUX chemins qui écrivent dans `poi_france` sont couverts
    — l'import universel (`lib/import/validator.ts`) et `import-datagouv`
    (`app/api/admin/import-datagouv/route.ts`, dont le commentaire
    « pas de doublon possible sans ID stable » n'était plus vrai).
  - **Effet de bord traité dans le même chantier** : tant que `id` était
    aléatoire, tout ce qui était envoyé était écrit, et compter
    `inserted = batch.length` disait vrai. Depuis le correctif un rejeu n'écrit
    RIEN — et ce compteur annonçait « 1 200 POI importés » sur un import qui
    n'en créait aucun. Les deux chemins font désormais `.select('id')` après
    l'upsert : `ON CONFLICT DO NOTHING` ne renvoie que les lignes réellement
    écrites, d'où des compteurs `inserted` / `ignored` exacts, et un journal où
    un rejeu affiche `[SKIP]` et non `[OK]`.
  - **`ECH-003` était FAUX** : mesuré le 2026-09-11, l'import de campagne se
    rattache déjà à une campagne existante par liaison plateforme ou nom
    identique (`findMatchingCampaign`, `route.ts:208-228`), puis purge la plage
    de dates du fichier avant réinsertion (`route.ts:350-362`). Rejouer le même
    fichier est donc déjà idempotent. Une seconde campagne n'apparaît que si le
    nom ne correspond à rien — ce qui est le comportement demandé.

### PERF-001 [Goulot] 21 `count(exact)` sur `iris` par appel de route
- **Localisation** : `app/api/admin/iris/stats/route.ts:41-49` (6 comptages
  parallèles) et `:61-66` (15 comptages parallèles, un par département)
- **Constat** : 21 requêtes de comptage exact quasi simultanées sur une table de
  51 000 lignes. `CLAUDE.md` limite explicitement à **3 appels Supabase
  parallèles** et interdit les full scans sur `iris`.
- **Impact** : c'est le motif exact de l'incident du 28/03 consigné dans
  `CLAUDE.md` (« Prefetch 24 colonnes IRIS × bbox France → I/O épuisé → 504 →
  down heures »). Sur un compute Nano à 250 IOPS, quelques ouvertures
  simultanées de cette page suffisent à épuiser le budget.
- **Gravité** : critique
- **Effort** : M
- **Traité le 2026-09-11** (`sql/131`) : une RPC en **une passe, 112 ms**, contre
  ~15 s cumulés. Facteur 130, mesuré à l'`EXPLAIN ANALYZE`.
- **Et la route mentait sur quatre de ses neuf statistiques** — découvert en la
  lisant pour la corriger : `nb_depts` affichait **2** au lieu de 104 (il
  comptait les départements distincts parmi 500 lignes prises sans tri) ;
  `with_geom` recopiait `total` sans vérifier (49 448 au lieu de **49 363**,
  masquant 85 IRIS sans géométrie) ; `table_size` et `index_size` étaient des
  chaînes figées (`'28 MB'`, `'5.7 MB'`) alors que la table pèse **221 Mo**.
  Ces corrections sont des **changements de comportement visibles, assumés** :
  une page de supervision ne peut pas afficher quatre chiffres faux sur neuf.

### ARC-001 [Architecture] La protection des routes dépend de deux listes
- **Localisation** : `middleware.ts:17-40` (`PROTECTED_API_PREFIXES`),
  `middleware.ts:136-156` (`matcher`), commentaire `middleware.ts:128-131`
- **Constat** : une route n'est protégée que si son chemin figure **à la fois**
  dans le `matcher` et dans `PROTECTED_API_PREFIXES`. Le fichier le documente
  lui-même : « Une route absente d'ICI n'est JAMAIS protégée, même si son
  préfixe figure dans PROTECTED_API_PREFIXES ».
- **Impact** : ajouter une route sous un préfixe déjà protégé en oubliant le
  `matcher` la rend **publique sans aucun signal** — ni erreur, ni test rouge.
- **État au 2026-09-11, vérifié** : **aucun trou aujourd'hui.** Le modèle réel
  est « middleware **OU** garde en handler », et
  `tests/unit/api/routes-publiques.test.ts` établit que les 170 routes ont
  toutes au moins l'une des deux, sauf trois publiques assumées. La plupart des
  familles récentes ne sont même pas dans le matcher et s'appuient entièrement
  sur `requireAuth`/`requireAdmin`. C'est donc une **fragilité**, pas une faille.
- **Gravité** : haute (ramenée de « faille » à « fragilité verrouillée par un
  test » — le test échoue si une route nue apparaît, vérifié en en créant une)
- **Effort** : S (un test suffit ; modifier `middleware.ts` est hors périmètre,
  fichier protégé)

### MAINT-001 [Maintenabilité] 138 `catch` avalent leur erreur
- **Localisation** : 138 occurrences dans `lib/`, `app/`, `components/`. Les plus
  préoccupantes :
  - `app/api/admin/sources/[id]/route.ts:148-152` — le `DROP TABLE` échoue,
    l'erreur est loggée, **et la suppression de la source se poursuit**
  - `app/admin/organizations/[id]/page.tsx:236, 267, 282, 311, 326` — cinq
    actions d'administration (reset de mot de passe, changement de rôle, retrait
    de membre, assignation et révocation de source)
  - `lib/auth/getSessionOrg.ts:58, 72` — échec de lecture du JWT
  - `lib/dsp/logger.ts:36-38` — échec d'écriture dans `dsp_api_logs`
  - `lib/inngest/functions/agentAutoPilotDaily.ts:105, 115` — « best-effort »
- **Impact** : dans le cas du `DROP TABLE`, une table orpheline reste en base.
  Dans les actions d'administration, l'utilisateur clique, rien ne se passe, et
  **aucun message n'apparaît** — il ne peut pas savoir que son action a échoué.

- **Traité le 2026-09-11, après vérification cas par cas.** Les 10 cas cités
  n'étaient pas tous des défauts :

  | Cas | Verdict |
  |---|---|
  | 7 actions d'`app/admin/organizations/[id]/page.tsx` | **réellement muettes** — corrigées, chacune affiche désormais un message nommant l'action |
  | `sources/[id]/route.ts:148` (`DROP TABLE`) | déjà journalisé. Mais le commentaire annonçait un « fallback: try deleting directly » **qui n'existe pas** — corrigé, et la trace passe désormais par le journal du projet en nommant la table orpheline |
  | `getSessionOrg.ts:58, 72` | **légitimes** — ce sont des sondes : on tente le format de cookie simple, puis le format découpé. Avaler l'échec du premier pour essayer le second est le bon comportement. Laissés tels quels |
  | `lib/dsp/logger.ts:36` | **légitime** — une fonction de journalisation ne doit jamais lever et casser l'opération de l'appelant. Laissée telle quelle |

  L'audit avait donc sur-signalé : 3 des 10 cas les plus « préoccupants » étaient
  corrects par conception. Le compte global de 138 reste indicatif et demande le
  même tri au cas par cas.

- **Gravité** : haute → **moyenne** (les cas visibles par l'utilisateur sont
  traités ; le reste est à trier)
- **Effort** : M

### PERF-002 [Goulot] Le patron de batch cité par `CLAUDE.md` insère ligne à ligne
- **Localisation** : `lib/import/inserter.ts:36` (boucle) et `:65` (upsert)
- **Constat** : `CLAUDE.md` ordonne « Inserts DB : batch par 50 max (pattern
  `lib/import/inserter.ts`) ». Ce fichier découpe bien par 50, mais exécute
  ensuite **un `.upsert()` par ligne** — 50 allers-retours réseau par lot.
- **Impact** : facteur 50 sur le nombre d'opérations, sur une instance à
  250 IOPS. Et la règle de `CLAUDE.md` désigne ce fichier comme la référence à
  copier : le défaut se propage à chaque nouvel import écrit sur ce modèle.
- **Nuance** : la boucle existe pour produire un rapport d'erreur ligne par
  ligne (`errors`, `firstError`, label de la ligne fautive). C'est un arbitrage
  défendable — ce qui ne l'est pas, c'est qu'il soit présenté comme un patron de
  batch.
- **Gravité** : haute
- **Effort** : M

### ECH-002 [Échelle] 13 appels externes sans expiration ni reprise
- **Localisation** :
  - `lib/dsp/dv360/client.ts:62, 106, 144, 173, 194, 216, 241, 249, 255, 281, 287`
    (11 appels vers `displayvideo.googleapis.com`)
  - `lib/dsp/tiktok/client.ts:54, 77` (`business-api.tiktok.com`)
  - `lib/bidding-ml/client.ts:68` (`*.modal.run`)
- **Constat** : aucun `signal`, aucun `AbortSignal.timeout`, aucune reprise.
- **Impact** : un tiers lent bloque l'invocation serverless jusqu'au délai de la
  plateforme. Une panne de Modal fige le pilote automatique quotidien.
- **Contrôle** : `lib/isochrones/fetcher.ts:127` et
  `lib/civic-health/atmofrance-client.ts` font, eux, les choses correctement
  (AbortController + reprise). Le savoir-faire existe dans le projet.
- **Gravité** : haute
- **Effort** : S

### PERF-003 [Goulot] Insertions par lots de 500, dix fois la limite
- **Localisation** : `app/api/admin/import-datagouv/route.ts:24, 282`
  (`CHUNK_SIZE = 500` vers `poi_france`) ; `lib/radio/radio-matcher.ts:249-255,
  304-310` (upsert par 500 dans `emetteur_radio_stations`, table issue d'un
  produit cartésien département × radios × émetteurs)
- **Impact** : violation directe de la règle de 50 de `CLAUDE.md`, sur les deux
  imports les plus volumineux du projet.
- **Gravité** : haute
- **Effort** : S

### DUP-001 [Duplication] `fmtNum` dupliqué et **déjà divergent**
- **Localisation** :
  - `app/map/analyse/digital/_components/SyncMap.tsx:38-45` — abrège en G/M/k,
    séparateur décimal **point** → « 1.2M »
  - `components/digital/AnalyseV2.tsx:71-74` — abrège en M/k, séparateur décimal
    **virgule** → « 1,2M »
  - `app/admin/carreaux-import/_components/shared.ts:59-61` et
    `components/campaign/_shared.tsx:28-30` — `toLocaleString('fr-FR')` sans
    abréviation
- **Constat** : même règle métier (abréger un grand nombre pour l'affichage),
  quatre implémentations, et **deux qui produisent des sorties différentes pour
  la même valeur**.
- **Impact** : le même volume d'impressions s'affiche « 1.2M » sur un écran et
  « 1,2M » sur un autre. Choisir la version de référence est un **changement de
  comportement visible** → hors périmètre du refactor.
- **Gravité** : haute
- **Effort** : S (mais arbitrage requis)

### ECH-003 [Échelle] Rejeu d'un import de campagne : campagne dupliquée
- **Localisation** : `app/api/admin/campaigns/import/route.ts:246-269` et `:350`
- **Constat** : quand aucune campagne existante n'est appariée, une nouvelle est
  créée par simple `insert`. Et la purge anti-doublon ne s'exécute que si
  `existingCampaign && parsed.dateStart && parsed.dateEnd`.
- **Impact** : une reprise réseau ou un double envoi crée une seconde campagne.
  Sans plage de dates détectée dans le fichier, les lignes de
  `dsp_campaign_data` se dupliquent.
- **Gravité** : haute
- **Effort** : M

### SEC-001 [Sécurité] routes d'écriture sans validation Zod — **CLOS : 39 sur 40**
- **Localisation** : au 2026-09-11, **40** routes (et non 38 : le premier compte
  ratait celles dont le schéma est importé d'un autre fichier) lisaient
  `request.json()` ou `.formData()` sans schéma.
- **Constat** : `CLAUDE.md` impose « validation Zod » sur les routes API.
- **Impact** : atténué — ces routes sont derrière `requireAdmin` ou
  `requireAuth`, l'appelant est donc authentifié. Le risque est la corruption de
  données par entrée malformée, pas l'accès non autorisé.
- **Gravité** : haute
- **Effort** : L
- **Avancement (2026-09-11)** — `lib/api/valider-corps.ts` fournit
  `lireCorps(request, schema)` : ne lève jamais, rend un résultat et non une
  `NextResponse` (les routes du projet ne partagent pas une forme d'erreur), et
  traduit les messages Zod une seule fois.
  - **Tranche 1 — identité et multi-tenant** (7) : `admin/users`,
    `admin/users/[id]`, `admin/organizations`, `admin/organizations/[id]`, ses
    `members` et son `reset-password`, `user/switch-org`.
  - **Tranche 2 — administration et référentiels** (9) :
    `admin/campaigns/[id]/organizations`, `admin/sources`, `admin/sources/[id]`,
    `admin/organizations/[id]/sources` et son `assign`, `admin/poi-categories`,
    `admin/iris/metadata`, `admin/init-admin`, `admin/dsp/dv360/oauth/start`.
  - **Tranche 3 — carte et calculs** (4) : `map/ooh`, `isochrone-cache-check`,
    `admin/geocode/update`, `bidding/train`.
  - **Tranche 4 — imports, copilote et agents** (19) : les quatre routes d'import
    JSON (`import-datagouv`, `import-geo`, `import-geo/register`,
    `import-ooh/arcgis`), les trois dépôts multipart (`import-poi/parse`,
    `iris-crawler/manual-upload`, `radio/import-arcom-ods`), le pipeline POI
    (`import-poi/dry-run`, `import-poi/execute`, `geocode/batch`),
    `iris-crawler/manual-import`, `isochrone-battle/apply-battle`, les quatre
    routes LLM (`chat`, `pilot`, `smart-prompt`, `agent/chat`), les deux routes
    d'agent (`analyze-drift`, `apply-recommendation`) et
    `digital/[campaignId]/ai-analysis`.
  - **Reste UNE route** : `app/api/isochrone-battle/route.ts`, fichier **PROTÉGÉ**
    par `CLAUDE.md`. Y toucher demande une demande explicite.
  - `lireFormulaire` a été ajouté pour les dépôts multipart : il valide les champs
    TEXTE par un schéma et rend le `FormData` pour les fichiers, dont la
    validation (extension, taille) est propre à chaque route. `instanceof File`
    remplace les casts `as File | null` : sur une valeur texte déposée sous
    « file », ce cast mentait et `file.name.toLowerCase()` levait en 500.
- **Huit défauts fermés au passage**, chacun commenté dans le code :
  - `admin/users` POST acceptait un rôle inconnu : le compte Auth était créé,
    puis l'échec de la mise à jour du profil était journalisé **sans être
    remonté** — l'appelant recevait un 201 pour un compte au rôle par défaut.
  - `admin/iris/metadata` POST faisait `Object.entries(body)` sans vérifier que
    le corps est un objet : sur une chaîne, il écrivait `0 → 'a'`, `1 → 'b'`.
  - `admin/geocode/update` ne contraignait pas `action.type` : un type inconnu
    traversait les trois `else if`, le fichier était réécrit à l'identique et la
    route répondait `{ success: true }`.
  - `import-poi/execute` ne vérifiait **que** `fileId`, là où `dry-run` vérifiait
    aussi `geolocation.mode` : les deux étapes d'un même parcours divergeaient, et
    une configuration sans `geolocation` levait plus loin, dans le flux, en 500.
    Les deux partagent désormais `ConfigImportSchema` (`lib/import/schemas.ts`).
  - `import-poi/parse`, `radio/import-arcom-ods` et `iris-crawler/manual-upload`
    lisaient `formData.get('file') as File | null` — un cast qui ment sur une
    valeur texte. Et les deux premières ne protégeaient pas `req.formData()`, qui
    **lève** sur un corps non multipart : 500 pour une faute d'appelant.
  - `geocode/batch`, `import-poi/dry-run` et `execute` se servent de `fileId` en
    PRÉFIXE de filtre sur le répertoire temporaire
    (`readdirSync(...).filter(f => f.startsWith(fileId))`). `fileId` est un
    `randomUUID()` posé par `/parse` : l'exiger au format UUID empêche qu'une
    valeur vide ou fantaisiste y sélectionne le premier fichier venu.
  - `pilot` lisait `body.mode === 'autonome' ? 'autonome' : 'guide'` : tout mode
    mal orthographié retombait **en silence** sur « guide ». On croyait piloter en
    autonome, on pilotait en guidé.
  - `import-ooh/arcgis` lisait `replace === true` : la chaîne « true » valait donc
    FAUX. Un appelant qui croyait demander un remplacement complet obtenait un
    ajout.
- **Dédoublonnage induit** : la liste des rôles était écrite à **cinq** endroits
  — `api/admin/roles`, deux littéraux en dur dans `organizations/[id]/members`,
  et un cinquième côté client (`app/admin/organizations/[id]/page.tsx:42`,
  `const ROLES = ['client', 'admin', 'super_admin']`), trouvé en vérifiant les
  appelants. Source unique dans `lib/auth/roles.ts`, garde-fou
  `satisfies Record<UserRole, _>`.
- **Vérification des appelants (2026-09-11)** : faute de tests d'intégration, les
  39 schémas ont été confrontés un par un au code client qui les appelle — corps
  `JSON.stringify` relu, type de chaque champ remonté jusqu'à son `useState` ou
  son `<select>`. Deux points méritaient l'examen :
  - `import-poi/execute` envoie `organizationId` : un `''` aurait produit un 400
    là où la route passait. Vérifié — le `<select>` n'expose que des identifiants
    d'organisation, et l'état par défaut est un UUID.
  - `apply-battle` : `useMapLayers.ts:786` déclare `geojson: object`, alors que la
    route annonçait `string`. Ce sont DEUX tableaux différents ; celui qui part
    vers la route est construit avec `geojson: JSON.stringify(f.geometry)`
    (`useMapDirectActions.ts:272`), donc bien une chaîne. Le schéma est correct,
    et la bataille d'isochrones n'est pas menacée.

### ARC-002 [Architecture] 10 cycles d'import dans `lib/`
- **Localisation** : `lib/agent/intents/index.ts:35-43` ↔ chaque intent
  important `registerIntent` (8 cycles) ; `lib/chat/tools/index.ts:47` ↔
  `lib/chat/tools/schemas.ts:7`
- **Impact** : limité en pratique — huit des dix passent par des `import()`
  dynamiques, donc pas de crash au chargement. Le coût est la compréhension et
  le risque au moindre passage en import statique.
- **Gravité** : moyenne
- **Effort** : M

### PERF-004 [Goulot] N+1 sur l'import Arcom : plus de 2 000 requêtes
- **Localisation** : `app/api/radio/import-arcom-ods/route.ts:96-127`
- **Constat** : un SELECT puis un UPDATE ou INSERT **par radio**, dans une
  boucle. Avec plus de 1 000 radios, cela fait plus de 2 000 requêtes
  séquentielles par import.
- **Gravité** : moyenne
- **Effort** : M

### PERF-005 [Goulot] 7 RPC séquentiels par appel de l'outil d'analyse du chat
- **Localisation** : `lib/chat/tools/analyseComplete.ts:325-333`
- **Constat** : 7 appels `smart_demographie_stats` en séquence, avec repli sur
  `carreaux_filosofi` (2,3 M de lignes). Par ailleurs `:184-190` construit un
  `Promise.all` dont la taille suit `poi_categories.length`, non plafonné par le
  schéma (`z.array(z.string())` sans `.max()`) — le fan-out est piloté par le LLM.
- **Gravité** : moyenne
- **Effort** : M

### DUP-002 [Duplication] Le filtre « sources de l'organisation » écrit trois fois
- **Localisation** : `lib/auth/getOrgSourceIds.ts:12-26` (helper canonique),
  `app/api/map/pois/route.ts:27-41` (copie locale),
  `app/api/map/categories/route.ts:54-58` (requête réinlinée)
- **Constat** : même règle d'autorisation (résoudre les `data_sources` visibles
  par une organisation), trois implémentations. **Pas encore divergentes.**
- **Impact** : c'est une règle d'**autorisation**. Le jour où elle évolue, en
  oublier une des trois ouvre ou ferme des données silencieusement.
- **Gravité** : moyenne
- **Effort** : S

### ECH-004 [Échelle] Le garde-fou d'I/O est lui-même en mémoire d'instance
- **Localisation** : `lib/api/rate-limit.ts:21` (`importHits`), `:53`
  (`fallbackMaps`), `app/api/chat/route.ts:43` (`RL_MAP`)
- **Constat** : le compteur qui limite les imports d'administration à 3 par
  60 secondes vit dans la mémoire du processus. Sur Vercel, chaque invocation
  peut être une instance différente.
- **Impact** : la limite est contournée de fait dès que plusieurs instances
  servent en parallèle — et c'est précisément ce garde-fou qui protège le budget
  I/O qui a déjà mis l'application à terre trois fois.
- **Gravité** : moyenne
- **Effort** : M

### MAINT-002 [Maintenabilité] `campaign_dsp_report` n'a pas de clé primaire
- **Localisation** : table PostgreSQL, écrite par
  `app/api/digital/[campaignId]/reconcile/pull/route.ts`
- **Constat** : seule table du schéma `public` sans clé primaire (vérifié sur
  `pg_index`).
- **MON IMPACT INITIAL ÉTAIT FAUX**, corrigé le 2026-09-11. J'avais écrit
  « rien n'empêche structurellement un doublon au rejeu ». En lisant
  `app/api/digital/[campaignId]/reconcile/pull/route.ts:65-67`, la route fait
  un **`DELETE` ciblé puis `INSERT`** — exactement le patron idempotent que
  `ARCHITECTURE.md` recommande pour cette famille de tables. **Un rejeu ne peut
  pas dupliquer.** 2 131 lignes en base, toutes distinctes, vérifié.
- **Décision : ne pas poser de clé primaire.** Elle ne résoudrait rien, aucune
  clé naturelle fiable n'existe (voir ci-dessous), et ajouter une colonne
  risquerait de casser les fonctions SQL qui lisent la table.
- **Découverte annexe, elle réelle** : `ARCHITECTURE.md` décrit « 2 grains
  disjoints : date×canal + CP ». La donnée dit autre chose — **0** ligne avec
  `postal_code` NULL (le grain date×canal n'existe pas), 2 041 avec `date` NULL,
  et **90 avec les deux renseignés**, forme non documentée. La doc est corrigée.
- **Gravité** : moyenne → **basse** (wart de modélisation, pas un défaut)
- **Effort** : S

### ARC-003 [Architecture] `init-admin` est inatteignable
- **Localisation** : `app/api/admin/init-admin/route.ts:13-15`
- **Constat** : la route qui crée le **premier** administrateur porte son propre
  garde (`x-admin-key`), mais son chemin est sous `/api/admin`, donc le
  middleware exige déjà une session valide.
- **Impact** : il faut être connecté pour créer le premier compte. Amorçage
  impossible sur une installation neuve.
- **Gravité** : moyenne
- **Effort** : S

### MAINT-003 [Maintenabilité] `useMapLayers.ts` dépasse le seuil du projet
- **Localisation** : `app/copilote/_hooks/useMapLayers.ts` — **1 118 lignes**
- **Constat** : seul fichier au-dessus des 1 000 lignes que `docs/known_tech_debt.md`
  se fixe. Les 14 suivants sont entre 550 et 981 lignes.
- **Gravité** : moyenne
- **Effort** : M

### MAINT-004 [Maintenabilité] Les fonctions les plus longues sont des composants entiers
- **Localisation** : `app/admin/sources/page.tsx:49` (880 lignes),
  `app/copilote/_hooks/useMapInit.ts:103` (879), `app/map/page.tsx:80` (848),
  `app/admin/radio/page.tsx:92` (825)
- **Constat** : ces fonctions couvrent la quasi-totalité de leur fichier. La
  première fonction réellement « métier » est
  `app/api/admin/campaigns/import/route.ts:70` (399 lignes).
- **Gravité** : moyenne
- **Effort** : L

### MAINT-005 [Maintenabilité] 88 `as unknown as`
- **Localisation** : 88 occurrences, dont 35 dans
  `app/copilote/_hooks/useMapInit.ts` et 14 dans `useMapLayers.ts`
- **Constat** : la majorité sont des expressions MapLibre, dont le typage
  générique ne peut pas être exprimé — un cast y est la pratique admise.
- **Gravité** : basse
- **Effort** : L

### MAINT-006 [Maintenabilité] 14 `any` et 2 suppressions de type
- **Localisation** : 14 `any` tous dans `app/api/`, dont **6 dans le fichier
  protégé** `app/api/isochrone-battle/route.ts` (188, 252, 289, 295, 326, 402).
  Les 8 autres : `app/api/isochrone-battle/apply-battle/route.ts:60, 70, 71`,
  `app/api/isochrone-battle-v2/route.ts:168, 174, 201`,
  `app/api/map/pois/route.ts:107, 160`. Deux `@ts-ignore` :
  `lib/mcp/datagouv.ts:184`, `app/api/chat/route.ts:144`
- **Constat** : zéro `any` dans `lib/` et `components/`.
- **Gravité** : basse
- **Effort** : M

### SEC-002 [Sécurité] Filtre PostgREST construit par interpolation
- **Localisation** : `lib/auth/getSessionOrg.ts`, `app/api/map/pois/route.ts:27-41`,
  `app/api/map/categories/route.ts:54-58`
- **Constat** : le filtre est bâti en template string
  (`.or(\`organization_id.eq.${session.orgId},...\`)`). `session.orgId` provient
  de `profiles.organization_id`, une valeur serveur, **pas d'une entrée
  utilisateur** — non exploitable en pratique.
- **Impact** : aucun aujourd'hui. Code fragile si la provenance de la valeur
  change un jour.
- **Gravité** : basse
- **Effort** : S

### MAINT-007 [Maintenabilité] `carreaux_1km` : `GRANT` contradictoire avec sa RLS
- **Localisation** : `sql/129_carreaux_1km_palier_z9_z11.sql`
- **Constat** : la table a `ENABLE ROW LEVEL SECURITY`, **zéro policy**, et un
  `GRANT SELECT ... TO authenticated`. Les deux se contredisent : le rôle
  `authenticated` lit zéro ligne. Seul `service_role`, qui contourne les RLS,
  accède réellement aux données.
- **Impact** : aucun — les tuiles passent par `service_role`. Mais le `GRANT`
  ment sur l'intention.
- **Note** : constat sur du code écrit dans cette même session, le 2026-09-11.
- **Gravité** : basse
- **Effort** : S

---

## Ce qui a été vérifié et trouvé conforme

Cette section existe pour éviter qu'un futur audit refasse le même travail.

| Vérification | Résultat |
|---|---|
| `createAdminClient` dans un fichier `'use client'` | **Aucun** — la clé `service_role` ne peut pas fuir |
| `lib/` important `app/` | **Aucun** sur 193 fichiers |
| Accès Supabase depuis un composant `.tsx` | **Aucun** |
| Secrets en dur (`sk-`, `eyJ`, `AIza`, `AKIA`, clés privées) | **Aucun** hors placeholders de `.env.example` |
| IDOR multi-tenant | **Aucun** — `lib/campaigns/access.ts` centralise les contrôles, appliqués partout |
| SSRF | Whitelists correctes : `import-datagouv/route.ts:32-63` (avec revalidation des redirections), `import-ooh/arcgis/route.ts:32-52` (avec détection d'IP privée) |
| Données sensibles dans les logs | **Aucune** |
| Injection SQL | **Aucune** — RPC paramétrées, builder Supabase, tagged templates |
| `getUser()` sur une route API (règle `CLAUDE.md`, incident du 28/03) | **0 occurrence** |
| Full scan sur `carreaux_filosofi` / `carreaux_*km` / `comptages_routiers` | **Aucun** — `sql/130` utilise même `reltuples` pour l'éviter |
| Cycles d'import dans `app/` | **Aucun** sur 353 fichiers |
| Idempotence des callbacks OAuth | **Correcte** — upsert `onConflict organization_id,provider` |
| Idempotence de l'import OOH ArcGIS | **Correcte** — upsert `onConflict source,source_ref` |
| Batch de 50 sur l'import de campagnes et l'import OOH | **Respecté** |
