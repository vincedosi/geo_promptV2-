# Campagnes multi-média et panneaux OOH d'une campagne sur la carte

> Spec du 2026-10-16. Branche `feat/ooh-campagnes`, partie de `feat/carte-zones-recette`
> (lot 3 de la carte en parcours) pour hériter du bouton « Autres ».
> Premier client : plan OOH **Marine nationale — TF4 septembre 2026** (20/09 → 02/10).

## 1. Décisions de Vincent (16/10)

1. Les **1 434 panneaux de Brest** étaient un test : on les **supprime** de la base.
2. On crée la notion de **campagne dans le workspace**, **multi-média** : une campagne porte des
   **lignes**, chacune d'un média parmi `DIGITAL`, `OOH`, `TV`, `RADIO`, `PRESSE`.
3. **Modèle 1** : de nouvelles tables au-dessus ; `dsp_campaigns` et tout le pilotage digital
   restent intacts.
4. **Pas de module à part, pas de page.** On place des panneaux : sous `/map`,
   **« Autres » → « Panneaux OOH et DOOH »** ouvre un overlay ; l'utilisateur **choisit une
   campagne** de son workspace, ses panneaux s'affichent avec le maximum d'information.
5. **Les panneaux d'une campagne sont privés au workspace** : « ce n'est pas un inventaire, c'est
   une campagne ». Ils appartiennent à la campagne, pas à un référentiel de régie partagé.
6. **L'import ArcGIS de Brest est supprimé** (route, page, liens de navigation) : c'était le test.
7. Écart Basic-Fit (882/905 clubs, 1 807/4 802 écrans) : on affiche les deux chiffres, la
   question part à la régie.
8. La table des panneaux doit contenir **le maximum d'information**. L'import doit être
   **générique** : la vague suivante = un adaptateur de plus, pas un nouveau script.

## 2. Hors champ

- Écran de création ou d'édition de campagne ; page « Campagnes ».
- Lignes DIGITAL / TV / RADIO / PRESSE réelles, et rattachement des 8 `dsp_campaigns`
  existantes (prévu avec le module campagnes, après la revue UX de la carte).
- Import depuis l'interface (dépôt de fichier, barre de progression web) : l'import de ce lot
  est un **script** lancé par l'équipe. Règle « API d'abord » : un plan de régie n'a pas d'API,
  le fichier est la seule source ; c'est assumé et limité à ce script.
- Scoring et enrichissement IRIS des panneaux (`compute_panneau_scores`, colonnes `score_*`).
- Emplacements des DROM : Mediaoutremer n'a fourni aucune liste.
- Côté React (gelé, P5) : `OohSection.tsx` et sa liste de régies restent tels quels.
- La table `import_runs_ooh` reste (lue par `/api/admin/imports`), vidée de son seul passage.

## 3. Ce que contient le plan TF4 (fichier analysé le 16/10)

Onglet `HYP1` : une ligne par réseau, avec régie, réseau, nombre d'écrans, format, nombre de
diffusions (« LOGS »), départ, durée, rang d'option, brut, net, frais, honoraires, total TTC HI ;
en pied, la plage horaire et les contacts 15+ / 18-24 de chaque réseau. Total 249 674 € TTC HI.

| Ligne | Écrans (plan) | Liste fournie | Ce qu'on sait par emplacement | Géolocalisation |
|---|---|---|---|---|
| Mediatransports — DOOH gares | 490, 215 gares | `LISTING GARE` : 152 IDF + 63 province | nom de gare, écrans par format (solo 9/16, solo 16/9, duo, trio, quatro), patrimoine potentiel max | référentiel SNCF : 194/215 exacts, 2 approchés, 19 par alias |
| Basic-Fit — DOOH salles | 4 802, 905 clubs | `LISTING BASIC FIT` : 1 807 lecteurs, **882 clubs** | libellé « ville rue code-club type » (WW, NC, DS) | BAN sur « rue, ville » |
| Stride — bornes de recharge | 236, 133 lieux | `LISTING CAMPUS` : 133 lignes | établissement, groupement, type (campus, cinéma, résidence), adresse, CP, ville, zone, écrans, taille d'écran, contacts/semaine, contacts 18-25/semaine | BAN sur adresse + CP |
| Mediaoutremer — 7 territoires DROM-COM | 662 faces | aucune | — | aucune : ligne sans emplacement |

**Écart Basic-Fit** : la liste donne 882 clubs et 1 807 lecteurs, le plan 905 clubs et
4 802 écrans. On garde les deux chiffres, sans en inventer un troisième (§ 6).

## 4. Base de données

Migrations à partir de **sql/260** (257-259 réservés au lot 3). Locales, `CREATE … IF NOT
EXISTS`, rejouables, sans `DROP`.

### 4.1 Purge de Brest — sql/260

Supprime les panneaux de la source « Brest Métropole 2026 »
(`source = 'custom_geo_brest-metropole_fr'`), son passage dans `import_runs_ooh`, puis la ligne
`data_sources`. Bloc `DO` avec assertion : il refuse de supprimer si la source porte autre
chose que des panneaux de Brest. Rejoué sur une base déjà purgée, il ne fait rien. Chaque
suppression lit son résultat.

### 4.2 Campagnes — sql/261

```
campagnes
  id uuid pk
  organization_id uuid not null → organizations   -- le workspace
  nom text not null                               -- « Marine nationale — TF4 septembre 2026 »
  annonceur text, vague text                      -- « Marine nationale », « TF4 »
  date_debut date, date_fin date
  budget_total_ttc numeric
  cle_import text                                 -- identité stable pour le rejeu du script
  metadata jsonb default '{}'                     -- fichier source, hypothèse, notes
  created_at, updated_at
  unique (organization_id, cle_import)

campagne_lignes
  id uuid pk
  campagne_id uuid not null → campagnes on delete cascade
  media text not null check (media in ('digital','ooh','tv','radio','presse'))
  ordre int not null
  regie text, reseau text, territoire text        -- « MEDIATRANSPORTS », « DOOH gare », « LA REUNION »
  nb_ecrans int, format text, nb_diffusions int
  date_debut date, date_fin date, duree_libelle text, rang_option text, plage_horaire text
  montant_brut, montant_net, frais, honoraires, total_ttc numeric
  contacts_15_plus bigint, contacts_18_24 bigint
  details jsonb default '{}'                      -- tout le reste de la ligne d'origine
  data_source_id uuid → data_sources              -- d'où viennent ses emplacements (null = DROM)

campagne_ligne_panneaux
  ligne_id uuid → campagne_lignes on delete cascade
  panneau_id uuid → panneaux_affichage on delete RESTRICT
  nb_ecrans int, formats text[]
  details jsonb default '{}'
  primary key (ligne_id, panneau_id)
```

- `on delete restrict` côté panneau : un panneau réservé par une campagne ne disparaît pas en
  silence lors d'un remplacement d'import. La suppression échoue en le disant.
- `date_fin` est calculée par le script à partir du départ et de la durée (« 2 semaines »,
  « 7 jours », « 2*5 jours », « 9 jrs dont 2 offert ») ; le libellé d'origine est gardé.
- Index : `campagnes(organization_id)`, `campagne_lignes(campagne_id)`,
  `campagne_ligne_panneaux(panneau_id)`.
- RLS activée, policies alignées sur le cloisonnement (sql/234) : lecture si
  `organization_id` est le workspace de l'utilisateur. Les routes passent par le client admin
  et filtrent elles-mêmes (§ 5).

### 4.3 Panneaux enrichis — sql/262

Colonnes ajoutées à `panneaux_affichage` (`add column if not exists`) :

| Colonne | Contenu |
|---|---|
| `nom_lieu` | « Gare d'Amiens », « Kedge Business School - Marseille », « Basic-Fit Orléans Avenue de la Libération » |
| `reseau` | « DOOH gare », « DOOH salle de sport », « DOOH borne de recharge » |
| `type_lieu` | gare, salle de sport, campus, cinéma, résidence |
| `numerique` | vrai pour un écran DOOH |
| `nb_ecrans` | écrans de l'emplacement dans la liste de la régie |
| `formats` | `text[]` : `9/16`, `16/9`, `duo`, `10"`, `WW`, `NC`… |
| `contacts_semaine`, `contacts_18_25_semaine` | quand la régie les donne (Stride) |
| `geoloc_methode` | `referentiel_gares`, `adresse_ban`, `alias_manuel`, `coordonnees_fournies` |
| `geoloc_qualite` | `sure`, `a_verifier` |
| `geoloc_score` | score BAN, ou 1 pour une correspondance exacte au référentiel |
| `geoloc_libelle` | ce que le géocodeur a reconnu (adresse ou gare), pour juger d'un coup d'œil |

Les colonnes existantes sont remplies quand on peut : `regie`, `type_panneau`, `adresse`,
`ville`, `code_postal`, `code_insee`, `code_departement`, `nb_faces` (= `nb_ecrans`),
`reference_panneau` (code club Basic-Fit), `source`, `source_ref`, `data_source_id`,
`organization_id`. **`metadata` garde la ligne d'origine en entier** (onglet, numéro de ligne,
toutes les cellules), y compris les lecteurs Basic-Fit d'un même club.

**Un emplacement introuvable n'entre pas dans la table** (`lat`/`lng` sont obligatoires). Il est
compté sur sa ligne (`details.non_places`, avec le nom et la raison) et listé dans le rapport du
script.

### 4.4 Identité, visibilité, rejeu

- **Une source privée par ligne de campagne** : `data_sources` « TF4 Marine — Basic-Fit »,
  `visibilite = 'privee'`, `organization_id` = Marine. La RLS existante (`source_visible`) fait
  le reste : les autres workspaces ne voient rien. Les panneaux appartiennent à la campagne :
  pas de référentiel de régie partagé entre campagnes ni entre workspaces (décision 5).
- `source` = `plan-ooh:<cle_import de la campagne>:<réseau>`, `source_ref` = identifiant stable
  dans le réseau (gare : code UIC ; Basic-Fit : code club ; Stride : établissement normalisé +
  CP). L'upsert sur `(source, source_ref)` garde les mêmes `id` d'un rejeu à l'autre de la même
  campagne. La vague suivante a sa propre clé, donc ses propres panneaux.
- Rejeu du script = même résultat : la campagne est retrouvée par
  `(organization_id, cle_import)`, ses lignes et leurs liens sont remplacés (DELETE ciblé dont
  l'erreur est lue, puis INSERT).

### 4.5 Lecture — sql/263

`campagne_ooh_jsonb(p_campagne uuid, p_org uuid, p_limite int default 20000) returns jsonb` :
la campagne, ses lignes OOH (avec le nombre d'emplacements placés et non placés), et ses
panneaux en GeoJSON. Elle lit `p_limite + 1` panneaux et rend `tronque`. C'est une RPC jsonb
parce que TF4 dépasse 1 000 points (troncature PostgREST, CLAUDE.md). Elle rend `null` si la
campagne n'est pas dans `p_org`. `EXPLAIN ANALYZE` dans l'en-tête.

## 5. API

Deux routes en lecture sous `/api/map/ooh/` (déjà couvert par le middleware), `force-dynamic`,
`createAdminClient()`, workspace actif par `getSessionOrg(req).orgId` (patron
`app/api/map/jeux-recommandes/route.ts`), Zod sur les paramètres.

- `GET /api/map/ooh/campagnes` → les campagnes du workspace ayant au moins une ligne OOH :
  `id, nom, annonceur, vague, date_debut, date_fin`, et par ligne `media, regie, reseau,
  nb_ecrans, nb_places, nb_non_places`. Bornée : un workspace a peu de campagnes, `limit 200`
  écrit et justifié.
- `GET /api/map/ooh/campagnes/[id]` → la sortie de `campagne_ooh_jsonb`. 404 si la campagne
  n'est pas dans le workspace actif ; 500 avec message français sinon.

`/api/map/ooh` (l'ancienne lecture par régies) n'est plus appelée par l'Angular. Elle reste
pour le React gelé.

## 6. L'overlay « Autres » → « Panneaux OOH et DOOH » (Angular)

Dans `panneaux/autres/panneau-autres.component.ts`, la section OOH actuelle (« 1 434 panneaux ·
Brest Métropole », filtre `OOH_REGIES`) est **remplacée** par un sélecteur de campagne.

1. **Liste** : les campagnes OOH du workspace (nom, vague, dates). Vide → « Aucune campagne OOH
   dans cet espace de travail. »
2. **Campagne choisie** : ses lignes OOH dans l'ordre du plan. Chacune affiche une pastille de
   couleur, la régie et le réseau, les dates, les écrans, le budget TTC, les contacts 15+ et
   18-24, et une case afficher/masquer.
   - Écart entre liste et plan : « 882 clubs placés · plan : 905 clubs, 4 802 écrans ».
   - Non placés : « 3 emplacements non placés » (dépliable, avec nom et raison).
   - DROM : « Liste des emplacements non fournie par la régie. »
3. **Carte** : une couche **dédiée** (pas la zone partagée des POI de `pois.service`), suivant
   le patron de « Mes zones » : un service fourni par la page (`campagne-ooh.service.ts`), des
   fonctions pures de pose et retrait (`couche-campagne-ooh.ts`), une source GeoJSON, un calque
   de cercles coloré **par ligne**, et un cerne `--poi-contour`. Les points `a_verifier` ont un
   cerne pointillé et sont listés dans la fiche. On recadre sur l'emprise de la campagne
   (métropole ; les DROM n'ont pas de points).
4. **Fiche d'un emplacement** au clic : nom du lieu, adresse, ville, CP, réseau, régie, type de
   lieu, écrans et formats, contacts, qualité de géolocalisation (méthode, libellé reconnu,
   score), campagne et ligne. En dessous, un bloc « Données de la régie » dépliable, qui
   affiche toutes les cellules de la ligne d'origine (`metadata`). Street View conservé.
5. Changer de workspace vide l'overlay et la couche. Effacer la carte retire la couche
   (`inscrireEffacement`).

**Couleurs** : nouvelle échelle **qualitative** `--ligne-media-1` à `--ligne-media-8`, définie
dans `globals.css` et `jetons.css` (thèmes sombre et clair) et documentée dans
`DESIGN_SYSTEM.md`. Lue par `CouleursService` puis passée à MapLibre en valeurs calculées
(jamais `var()` dans `paint`). Teintes à poser au plan, distinctes des `--nature-*` du module
risque.

**Retiré de l'Angular** : `OOH_REGIES` et le texte en dur « Brest Métropole ». Le test de parité
`carte-couches-paritaire` est mis à jour : la copie React reste, l'Angular n'en a plus.

## 7. Script d'import générique

`scripts/ooh/importer-plan.ts`, lancé par `npx tsx`. Il lit l'environnement local
(`.env.development.local`, jamais une clé en dur). Le fichier client est passé en argument et
**n'est jamais versionné** (`PM OOH/` est exclu via `.git/info/exclude`).

```
npx tsx scripts/ooh/importer-plan.ts --plan "<fichier.xlsx>" --espace marine \
  --campagne "Marine nationale — TF4 septembre 2026" --vague TF4 --cle marine-tf4-2026 [--a-blanc]
```

- **Étapes nommées**, avec une progression affichée (% et lignes traitées / total) : lecture →
  synthèse du plan → emplacements par réseau → géolocalisation → écriture → rapport.
  `--a-blanc` fait tout sauf l'écriture.
- **Adaptateurs** (`lib/ooh/plan/adaptateurs/`), un par format de régie :
  - `synthese-hyp` : l'onglet de synthèse → lignes de campagne.
  - `mediatransports-gares` : les deux blocs IDF et province.
  - `basic-fit` : découpe du libellé, regroupement des lecteurs par code club.
  - `stride-campus`.
  - Une interface commune : `lire(classeur) → { lignes, emplacements }`.
  - **La vague suivante = un adaptateur de plus**, ou aucun si le format est le même.
- **Géolocalisation** (`lib/ooh/plan/geolocaliser.ts`) :
  - **Adresses** : `lib/import/geocoder.ts` existant (BAN `/search/csv/`). Score ≥ 0,6 →
    `sure` ; de 0,3 à 0,6 → `a_verifier` ; sous 0,3 → non placé.
  - **Gares** : référentiel public SNCF « gares de voyageurs » (data.sncf.com, sans clé,
    téléchargé au lancement). Correspondance par nom normalisé, avec une **table d'alias
    versionnée** pour les 21 noms composés, vérifiée par le code INSEE de la commune.
  - **Basic-Fit** : BAN sur « rue, ville ». Si la rue manque (« FR Bayeux 7015 WW-1 ») : centre
    de la commune → `a_verifier`.
- **Écriture** : lots de 50, une requête par lot, repli ligne à ligne (patron
  `lib/import/inserter.ts`), `upsert … .select('id')`.
- **Rapport final** : compteurs par réseau (lus, placés sûrs, à vérifier, non placés) et un CSV
  des emplacements à reprendre, écrit hors du dépôt.

Dépendance externe nouvelle (référentiel SNCF) → `ARCHITECTURE.md` et le test de dérive de la
documentation.

## 8. Preuve attendue

- Tests unitaires des adaptateurs sur des **classeurs synthétiques** construits par les tests
  (aucune donnée client dans le dépôt) : découpe Basic-Fit, blocs gares, durées → dates, lignes
  DROM sans emplacement.
- Tests de la normalisation des noms de gare et des alias.
- Intégration : purge rejouable ; rejeu du script = mêmes `id` ; un autre workspace ne voit ni
  la campagne ni ses panneaux ; `restrict` refuse la suppression d'un panneau réservé ;
  `tronque` au-delà de la borne.
- Routes : 404 hors workspace, Zod, et le test de troncature PostgREST.
- Angular : specs du service, de la couche et de l'overlay.
- **Preuve navigateur dans les deux thèmes** : la liste, TF4 choisie, les quatre lignes, les
  points sur la carte, la fiche d'un panneau de chaque réseau, la ligne DROM, un point à
  vérifier, et le changement de workspace.
- Import réel de TF4 en local, avec ses compteurs reportés dans les écarts (§ 12).

## 9. Risques

- **Gares homonymes ou mal reconnues** : vérification par code INSEE, alias versionnés, points
  incertains marqués `a_verifier`, jamais placés en silence.
- **Basic-Fit sans CP** : une rue homonyme peut tomber dans une autre ville. La ville vient du
  libellé et elle est vérifiée contre la ville rendue par la BAN ; sinon le point est
  `a_verifier`.
- **Volume** : ≈ 1 230 points, un seul jeu GeoJSON, sous les 5 000 où `couche-pois` bascule en
  rendu GPU. Charge base négligeable (une RPC indexée par campagne).
- **Nom « campagne »** déjà employé (`dsp_campaigns`, `CampagnePlan`, étape campagne du module
  risque) : les nouveaux types sont préfixés (`CampagneMedia`, `LigneMedia`) et la fiche
  ARCHITECTURE dit la différence.

## 10. Suppression de l'import ArcGIS

Retirés dans le même commit, avec la doc (`ARCHITECTURE.md`) :
- la route `app/api/admin/import-ooh/arcgis/route.ts` et la page `app/admin/ooh-import/page.tsx` ;
- les liens « Import OOH » : `components/AppSidebar.tsx`, `app/dashboard/page.tsx`,
  `components/map/overlays/SettingsOverlay.tsx`, `angular/src/app/layout/navigation.ts`, et
  l'entrée inerte de `panneaux/reglages.component.ts` ;
- les mentions périmées : `lib/import/inserter.ts:194`, `lib/format/nombre.ts:14`.
- `tests/unit/api/quotas-partages.test.ts` prend la clé de quota en exemple : il est réécrit sur
  une clé encore vivante, sans perdre ce qu'il vérifie.

## 11. Questions ouvertes

Aucune : Q1 (visibilité), Q2 (ArcGIS) et Q3 (Basic-Fit) ont été tranchées le 16/10 (§ 1).

## 12. Écarts à la livraison

Relevés le 16/10 à l'import réel du plan TF4 en base LOCALE (espace `marine`, clé `marine-tf4-2026`), puis à la
preuve navigateur dans les deux thèmes. Captures hors dépôt, dans le dossier de session
`.superpowers/sdd/2026-10-16-ooh-campagnes/` (`T12-*.png`).

**Compteurs mesurés.** 4 onglets, 11 lignes, référentiel SNCF à 2 792 gares ; 1 256 panneaux et 1 256 liens écrits,
rejeu identique (0 panneau retiré).

| Réseau | Lus | Sûrs | À vérifier | Non placés | Plan |
|---|---|---|---|---|---|
| Mediatransports — gares | 215 | 215 (183 par le nom, 32 par alias ; 215 UIC distincts) | 0 | 0 | 215 gares, 490 écrans |
| Basic-Fit — salles | 915 | 695 | 213 | 7 (adresse introuvable par la BAN) | 905 clubs, 4 802 écrans |
| Stride — bornes | 133 | 119 | 14 | 0 | 133 lieux, 236 écrans |

- **Écart Basic-Fit, chiffre mesuré.** La spec annonçait 882 clubs (§ 1.7, § 3). La liste en donne **915** une fois
  les lecteurs regroupés par club (code club, ou ville + rue pour les 29 clubs sans code) ; **908** sont placés (879 par
  code, 29 sans code), portant 1 793 lecteurs. L'overlay affiche « 908 clubs placés · plan : 905 clubs, 4 802 écrans » :
  la liste dépasse le plan de 10 clubs, ce qu'un doublon de club sans code pourrait expliquer — question pour la régie,
  avec l'écart des écrans.
- **11 lignes de campagne, pas 4.** Une ligne par ligne chiffrée du plan : Mediaoutremer en porte 8 (La Réunion deux
  fois, budgets et formats différents : 200 faces 12 m² et 127 faces DOOH). L'overlay les regroupe en 3 lignes
  métropole et un bloc « 8 lignes sans emplacement · 662 faces » (« Liste des emplacements non fournie par la régie. »).
- **Table d'alias des gares : 32 entrées, pas 21.** Onze noms composés tombaient sur la mauvaise gare. Ordre de
  recherche : nom plein → dernière partie → première + dernière → première.
- **`geoloc_score` d'une gare** : 1 pour une correspondance sûre, 0,5 pour une gare à vérifier (première partie
  seule, hors bloc, homonymes) — la spec (§ 4.3) réservait 1 à la correspondance exacte.
- **Anneau pointillé** des points à vérifier : un calque `symbol` (`campagne-ooh-a-verifier`) qui pose une image
  dessinée, MapLibre n'ayant pas de trait pointillé de cercle.
- **Une source privée par RÉSEAU** (adaptateur), que la spec confondait avec « par ligne » : une liste n'est rattachée
  qu'à la première ligne de sa régie.
- **`checkImportRateLimit`** n'a plus d'appelant de production depuis le retrait d'ArcGIS ; gardé comme mécanisme
  générique des imports, son test est réécrit sur une clé d'essai.
- **Deux RPC, pas une** : `campagnes_ooh_jsonb` (liste de l'espace) s'ajoute à `campagne_ooh_jsonb`.
- **Dates** : celles de la campagne sont prises dans le titre du plan (« 20/09 - 02/10 ») ; celles des lignes sont
  calculées départ + durée − 1 et débordent : Mediatransports « 2 semaines » depuis le 21/09 va jusqu'au 04/10.
- **Mesures sur TF4** (sql/263, bloc « Mesure ») : requête des emplacements 1,24 ms, 397 buffers lus en cache, aucun
  disque ; appel complet `campagne_ooh_jsonb` 59 à 74 ms pour 1 559 517 caractères ; liste 2,4 ms.
- **Requêtes réseau** : aucune requête `/api/map/ooh/*` à l'ouverture de la carte ; une seule
  `GET /api/map/ooh/campagnes` à la première ouverture de la section.

**Défauts relevés à la preuve navigateur, non corrigés dans ce chantier (à trancher) :**

1. **Le recadrage ne montre pas la métropole.** Trois clubs Basic-Fit de métropole, sans code postal dans la liste,
   sont placés par la BAN outre-mer — « Laval » à Saint-Denis de La Réunion, « Saint Etienne » à Sainte-Rose et
   « Sainte-Marguerite » au Moule (Guadeloupe). Marqués à vérifier, ils entrent pourtant dans l'emprise : choisir TF4
   cadre le monde (z 2,3, de −137° à 64° de longitude) au lieu de la France (`T12-3a-recadrage-*.png`). Deux remèdes
   possibles : refuser à l'import un résultat BAN hors du département attendu quand la régie est métropolitaine, ou
   recadrer sur les seuls points sûrs.
2. **L'anneau pointillé est invisible sur fond clair.** L'image est dessinée en `--poi-contour` (#ffffff, invariant) :
   visible sur le fond « dentsu » en thème sombre (`T12-3b-zoom-a-verifier-sombre.png`), elle disparaît sur le fond
   « Clair » et sur tout fond du thème clair (`T12-3b-zoom-a-verifier-clair.png`) — et le point à vérifier perd aussi
   son cerne blanc, il ne s'y distingue donc plus d'un point sûr. Il faut une couleur d'anneau qui suive le thème.
3. **Ville d'un club Basic-Fit mal découpée** sur certains libellés : la fiche de « Basic-Fit Dijon Dijon Chanoine
   Kir » affiche Ville « 21000 Dijon Dijon Chanoine Kir » et Adresse « — » (`T12-4e-fiche-a-verifier-*.png`).

Console : aucune erreur MapLibre (`addLayer`, `addImage`, expression). Les avertissements « Expected value to be of
type number, but found null » viennent du fond de carte (ils reviennent sans aucune campagne affichée, à partir de
z 13) ; NG0956 vient du `@for (g of [generation()]; track g)` voulu de `carte-hote` (recréation au changement
d'espace).
