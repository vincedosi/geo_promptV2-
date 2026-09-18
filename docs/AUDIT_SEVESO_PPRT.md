# Audit Seveso / PPRT — phase 0

> Mesuré le **2026-09-18** sur la base **locale** (`supabase_db_genesis_app`,
> PostgreSQL 17.6 + PostGIS 3.3.7), qui porte les données ICPE et PPRT — la
> production n'en a que la structure. Aucune modification n'a été faite.
>
> Toutes les valeurs de ce document sont des **mesures**, pas des estimations.
> Quand une question n'a pas pu être tranchée, elle est en section « Inconnues »
> plutôt que comblée par une supposition.

---

## Ce que le prompt suppose, et ce que la mesure dit

Quatre prémisses du prompt ont été vérifiées avant tout le reste, parce
qu'elles conditionnent la faisabilité des phases 3 et 4.

| Prémisse du prompt | Vérification | Verdict |
|---|---|---|
| Zonage PPRT via **WFS** `PPRT_ZONE_RISQIND_FXX` sur `georisques.gouv.fr/services` | `GetCapabilities` du WFS listé : seulement `PPRT_COMMUNE_RISQIND_APPROUV`, `PPRT_COMMUNE_RISQIND_PRESCRIT`, `PPRT_PERIMETRE_RISQIND` | ❌ **La couche n'existe pas en WFS.** `PPRT_ZONE_RISQIND` est exposée en **WMS seulement** (image, pas de géométrie) |
| Ou **shapefile national** depuis l'espace de téléchargement Géorisques | Page « Plans de Prévention des Risques Technologiques » : archive téléchargeable aux échelles nationale / régionale / départementale, contenant périmètres, **zonages réglementaires et zonages d'aléa lorsque disponibles** | ✅ **C'est la bonne source.** Millésime annoncé : **février 2023** |
| Colonne population de `carreaux_filosofi` = `ind` | La colonne `ind` EXISTE mais vaut **NULL sur les 200 000 lignes** ; la valeur est dans `metadata->>'ind'` (jsonb) | ⚠️ **Bon nom, mauvaise colonne.** Lire le jsonb, pas la colonne |
| `carreaux_filosofi` (200 m) disponible pour le croisement | **200 000 lignes sur 2 298 582**, et ce n'est pas un échantillon réparti : emprise **lon −1,46 → 3,03 / lat 42,3 → 44,7**, soit une bande sud-ouest | 🔴 **Bloquant** — voir ci-dessous |

### Le bloquant, et la seule sortie

Les 200 000 carreaux locaux couvrent une **bande géographique contiguë** du
sud-ouest, pas la France. L'Étang de Berre (lon ≈ 5,1), Lyon, le Nord et
l'Est en sont **absents**. Un calcul de population exposée sur la base locale
rendrait donc `0` pour la quasi-totalité des sites Seveso — un zéro qui ne
viendrait pas d'une mesure.

Cause : `scripts/local/07-carreaux-200m.sh` rapatrie la table **par tranches de
100 000 depuis la prod** ; deux tranches seulement ont été jouées.

Le dump de disque ne sauve pas la situation : `C:/GENESIS/_dump_prod/carreaux_filosofi.sql`
fait 765 Mo pour **≈ 724 600 lignes** (comptées), sur 2 298 582. Il est
lui-même partiel — cohérent avec l'incident documenté dans l'en-tête du script
(« un `pg_dump` unique est mort à 730 Mo »).

**Conséquence : la production est la seule source complète du 200 m.** C'est
précisément le cas où « on a besoin de Supabase pour avancer ».

### Une alternative qui évite la prod, et son coût

`carreaux_1km` est **complète en local** : 374 511 mailles, **62 592 659
habitants**, emprise lon −5,14 → 9,57 (métropole entière). Elle porte des
colonnes **typées** (`population_totale`, tranches d'âge, revenus, logement) —
pas de jsonb à déballer.

| | `carreaux_filosofi` 200 m | `carreaux_1km` |
|---|---|---|
| Disponible en local | 200 k / 2,3 M, bande sud-ouest | **374 511, complète** |
| Population | `metadata->>'ind'` (jsonb) | `population_totale` (colonne typée) |
| Finesse face à un PPRT | Une zone PPRT fait **0,94 km² en moyenne** | Une maille de 1 km² **dépasse la zone moyenne** |
| Index GIST 3857 | oui | oui |

La finesse n'est pas un détail de confort ici : au prorata de surface, une
maille de 1 km² qui déborde largement une zone PPRT de 0,9 km² répartit ses
habitants sur une hypothèse d'uniformité que rien ne soutient à cette échelle.
**Le 200 m est le bon palier ; le 1 km est le palier de repli mesurable dès
maintenant.** À arbitrer (voir « Inconnues », Q1).

---

## À conserver

Tout ce qui suit est fonctionnel, cohérent et utilisé. **Rien à nettoyer ici.**

### Tables

| Objet | Lignes | Taille | RLS | État |
|---|---|---|---|---|
| `pprt_perimetres` | 664 | 15 Mo | activée, 0 policy (deny-all, convention du projet) | ✅ Utilisée par `/api/map/pprt` et `risques_industriels_carte` |
| `icpe_rubrique_familles` | 15 | 48 kB | activée, 0 policy | ✅ Registre des natures de risque, miroir de `lib/import/georisques/familles.ts` |
| `poi_france` (catégorie `risque_industriel`) | 99 152 dont **1 327 Seveso** (717 haut / 610 bas) | — | — | ✅ **C'est la table des sites.** Pas de table Seveso dédiée, et il ne faut pas en créer une |
| `carreaux_1km` | 374 511 | 142 Mo | — | ✅ Complète, colonnes typées |

`pprt_perimetres` porte **cinq index**, dont trois géométriques :
`idx_pprt_geom` (GIST sur `geom` 4326), `idx_pprt_geom_3857` (GIST sur
`geom_3857`) et `idx_pprt_geog` (GIST sur `geom::geography`, sql/179 —
**obligatoire**, sans lui le rattachement site↔PPRT retombe en Seq Scan :
118 340 ms contre 164 ms mesurés).

### Fonctions (toutes `SECURITY DEFINER`, convention du projet)

| RPC | Volatilité | Rôle |
|---|---|---|
| `risques_industriels_carte` | stable | Sites ICPE d'une bbox + rattachement PPRT + zone calculée (sql/175, sql/179) |
| `pprt_perimetres_carte` | stable | Périmètres PPRT d'une bbox (sql/178) |
| `pprt_importer_partition` | volatile | Import transactionnel par partition (sql/177) |
| `pprt_consolider_departement` | volatile | Rattrapage du département par recouvrement (sql/177) |
| `consolider_geo_icpe` | volatile | Rattrapage géo des POI ICPE (sql/174) |

### Code (18 fichiers, tous branchés)

Routes `app/api/map/risques-industriels`, `app/api/map/pprt`,
`app/api/admin/import-georisques`, `app/api/admin/import-pprt` ·
couches `RisqueIndustrielLayer.tsx`, `PprtLayer.tsx` (montées par
`app/map/page.tsx`) · panneau `RisqueIndustrielSection.tsx` ·
`lib/carte/palette-risques.ts`, `palette-pprt.ts`, `nature-zone.ts` ·
`lib/import/georisques/{familles,classement,identite-poi}.ts`,
`lib/import/pprt/normalisation.ts` · migrations `sql/173` à `sql/179`.

**Vérifié un par un : aucun orphelin.** Chacun a un consommateur vivant,
et tous sont couverts par des tests (`tests/unit/import/*`,
`tests/unit/carte/*`, `tests/unit/api/*`).

---

## À nettoyer

**Un seul item**, et ce n'est pas une suppression.

### `sql/176_population_exposee_site.sql` — écrite, jamais appliquée

| Preuve | Résultat |
|---|---|
| `pg_proc` pour `population_exposee_site` | **ABSENTE DE LA BASE** |
| `grep` d'un appelant dans `app/`, `lib/`, `components/` | **aucun** |
| Le fichier existe et est commité | oui |

La fonction croise **`carreaux_1km`**, pas `carreaux_filosofi` — un choix
différent de celui du prompt, et pris pour une raison écrite dans son en-tête
(le buffer est construit en `geography`, l'intersection en 3857 où vit l'index).
Sa signature est `(p_lon, p_lat, p_rayon_m)` : elle raisonne **buffer**, pas
zonage réglementaire.

**Action proposée : ne rien supprimer.** Ce fichier est le brouillon du
chantier que ce prompt commande, et il porte déjà la partie « mode buffer » de
la phase 4. Il faut décider s'il devient la base du `mode='buffer'` ou s'il est
remplacé. **À valider item par item avec Vincent avant toute action.**

### `data_registry` — rien à nettoyer, rien à corriger

La table compte **10 entrées, dont ZÉRO** concernant Seveso, ICPE, PPRT,
risque, danger ou carreaux. Il n'y a donc **aucune entrée morte** — mais aucune
entrée tout court. La phase 3 devra en créer (point 6 du prompt).

⚠️ Ses colonnes réelles sont `id, slug, label, category, description, metadata,
is_active, created_at` — **il n'y a pas de colonne `nom` ni `table_cible`**.

### `supabase/migrations/` — hors sujet, et c'est normal

43 fichiers, **aucun** ne concerne Seveso / ICPE / PPRT. Ce dossier n'est pas
l'historique réel du projet : les migrations vivantes sont les ~179 fichiers de
`sql/`, appliqués par le MCP Supabase (`ARCHITECTURE.md`, « Environnement de
développement local »). `[db.migrations]` est d'ailleurs à `false` dans
`supabase/config.toml`.

**Le prompt demande de déposer la migration de nettoyage dans
`supabase/migrations/`. Ce serait la ranger là où rien ne la lira.**

---

## Inconnues — à trancher avant la phase 2

**Q1. Quel palier de carreaux pour la population exposée ?**
Le 200 m est le bon palier (une zone PPRT fait 0,94 km² en moyenne), mais il
exige de rapatrier 2,1 M lignes depuis la prod. Le 1 km est disponible tout de
suite et complet, au prix d'une imprécision réelle à l'échelle d'un PPRT.
→ *Rapatrier le 200 m d'abord, ou livrer en 1 km puis affiner ?*

**Q2. Le millésime de février 2023 est-il acceptable ?**
Le zonage réglementaire téléchargeable date de février 2023. Nos 664 périmètres
viennent de la Géoplateforme et sont **vivants** (dépôts jusqu'à août 2026).
Les deux jeux ne diront donc pas toujours la même chose.
→ *Que fait-on quand un PPRT existe en Géoplateforme mais pas dans l'archive 2023 ?*

**Q3. `pprt_zones` et `pprt_perimetres` cohabitent-elles ?**
Ce ne sont **pas** des doublons : `pprt_perimetres` porte l'**enveloppe**
(664 assiettes PM3), `pprt_zones` porterait le **découpage interne** (R, r, B,
b, grisé). Mais deux tables aux noms voisins sur le même sujet s'appellent à
être confondues — quelqu'un supprimera l'une en croyant nettoyer l'autre.
→ *Renommer l'une des deux ? Ou une seule table avec une colonne de niveau ?*

**Q4. Où va la migration ?**
Le prompt dit `supabase/migrations/`, le projet utilise `sql/NNN_*.sql`.
→ *Confirmer `sql/` (recommandé : c'est le seul dossier réellement appliqué).*

**Q5. RLS et `SECURITY INVOKER`.**
Le prompt demande une policy de lecture pour `authenticated` et
`SECURITY INVOKER`. La convention du projet est **RLS deny-all** + routes en
`service_role` + `SECURITY DEFINER`. Les RLS du projet sont **dormantes**
(aucune route n'utilise la clé anon — 0 sur 205 routes mesurées).
→ *Suivre la convention du projet, ou le prompt ?*

**Q6. `id_gaspar` n'est pas encore importé.**
La clé de jointure vers GASPAR **existe** (`wfs_sup:generateur_sup_s.id_gaspar`,
vérifié le 2026-09-18 : 664/664 assiettes rattachables, 404 procédures
atteintes) mais `pprt_perimetres` ne stocke que `id_generateur`. La table
`pprt_documents` du prompt a `id_gaspar` en clé primaire.
→ *Faut-il une passe d'import supplémentaire sur `generateur_sup_s` en phase 3 ?*

**Q7. Le zonage d'aléa est-il réellement dans l'archive ?**
La page Géorisques annonce les zonages d'aléa « **lorsque disponibles** ». La
proportion de PPRT qui en portent n'a **pas** été mesurée — il faudrait
télécharger l'archive pour le savoir.
→ *À mesurer en début de phase 3, avant de promettre le niveau d'aléa à l'UI.*

---

## Ce qui ne doit pas être touché

`app/api/isochrone-battle/route.ts` · `get_isochrone_battle` ·
`clip_geojson_to_france` · `clip_rings_to_france` (interdits du prompt), plus
les fichiers protégés du projet : `middleware.ts`, `lib/carte/filtre.ts`,
`lib/carte/degrades.ts`.

---

**Fin de la phase 0. Aucune modification n'a été faite. Les sept questions
ci-dessus attendent un arbitrage avant la phase 1.**
