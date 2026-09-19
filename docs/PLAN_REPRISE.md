# Plan de reprise — 2026-09-19

> État : `main` propre, PR #3 **mergée**, 0 commit en attente.
> **1 452** tests unitaires + **36** d'intégration verts · `tsc` propre ·
> 0 erreur de lint · 0 export mort.
>
> Ce document classe ce qui reste **par qui décide**. Ce qui demande un
> arbitrage n'est pas mélangé à ce qui demande du travail — confondre les deux
> est la façon la plus sûre de ne faire ni l'un ni l'autre.

---

## 1. À faire par Vincent — deux gestes, dont un de sécurité

| # | Geste | Pourquoi maintenant |
|---|---|---|
| **1.1** | **Supprimer le projet Supabase `vkkdbygwbrxyogqosten`** | Plus rien ne s'y connecte. La mise en pause est refusée par Supabase (plan Pro), donc supprimer est le seul geste disponible — et c'est le bon, voir 1.2. |
| **1.2** | **Révoquer la clé `service_role`** | Elle est dans l'historique git depuis le 11/09. **Supprimer le projet la neutralise** ; le suspendre ne l'aurait pas fait. Les anciens `.env` qui la portaient sont sortis du dépôt vers `C:/GENESIS/_anciens_env/`. |

La sauvegarde `C:/GENESIS/_sauvegarde_locale/local-2026-09-19.dump` (338 Mo)
est **vérifiée par restauration réelle** et a été copiée hors du poste.

---

## 2. Arbitrages produit — rien ne presse, mais rien n'avance sans

### 2.1 Pollen et qualité de l'air : plus d'ordonnanceur

L'ingestion quotidienne passait par le cron Inngest `civic-daily-ingest`, et
**Inngest appelle `/api/inngest` sur l'URL publique de l'application** — le
déploiement Vercel, qui n'existe plus.

Mesuré : `pollen_map_daily` et `atmo_map_daily` portent **100 lignes en local
contre 6 004 et 4 986 en production**. Ces tables se purgent d'elles-mêmes à
J-2 : sans ingestion, elles se vident.

**Ce n'est pas une perte de données** — le WFS public Atmo republie tout chaque
jour, sans credential. C'est une perte d'**automatisme**.

En attendant : déclencher `POST /api/admin/civic-ingest` à la main. Un appel
remplit les deux tables.

Trois sorties possibles : remonter un ordonnanceur (il faudra une URL
publique), accepter le déclenchement manuel, ou retirer les deux calques si la
fraîcheur quotidienne n'est plus un besoin.

### 2.2 Calque flux routier : 1 100 tronçons au lieu de 408 030

Seuls les **comptages mesurés** ont été rapatriés. Les 406 930 lignes de proxy
OSM — onze valeurs forfaitaires recopiées — ne l'ont pas été : elles sont
dérivées d'OpenStreetMap, donc régénérables par `scripts/import_osm_roads.py`.

Le calque montre donc désormais ce qui est réellement mesuré. **C'est le
comportement correct**, et c'est aussi un changement visible. Régénérer le
proxy, ou retirer le calque : à trancher.

### 2.3 Six points sur la zone à risque

Détaillés au §6 de `docs/AUDIT_ZONE_RISQUE.md`. Les deux qui comptent :

- **Les libellés de gravité divergent** — « Seveso haut » dans l'overlay,
  « Seveso seuil haut » dans le panneau et la popup. Lequel fait foi ?
- **La maille `arrondissement` n'est pas proposée** à l'écran, alors que les
  deux routes l'acceptent depuis le 19/09. `ARCHITECTURE.md` la décrit comme le
  moyen de voir que « le nord de Marseille n'est pas Marseille ». L'exposer est
  une décision produit.

---

## 3. Travail technique identifié, par ordre de valeur

| # | Sujet | Effort | Ce qui le justifie |
|---|---|---|---|
| **3.1** | **Découper `AnalysePopulationOverlay.tsx`** — 1 403 lignes pour un seuil de 300 | L | Les briques présentationnelles sont déjà sorties. Le corps porte **dix-sept `useState`** : le découper impose un contexte ou un réducteur, donc une RESTRUCTURATION. Ce n'est pas un refactor à comportement constant, d'où son report — et d'où la nécessité de le décider plutôt que de l'improviser. |
| **3.2** | **Rendre la couverture de tests mesurable** | S | Aucun provider installé, aucune configuration. L'exigence « >80 % » n'est **pas vérifiable aujourd'hui** — on ne peut ni l'affirmer ni l'infirmer. Ajouter `@vitest/coverage-v8` est une dépendance, donc un choix. |
| **3.3** | **Finir la source unique des polices** | S | `fInter`/`fMono` sont encore redéclarés dans **sept fichiers** hors du périmètre audité (`ClusteringWizard`, `ClusterPanel`, `DiffusionMapLayer`…). `lib/design/polices.ts` existe pour les accueillir ; trois fichiers y sont déjà branchés. |
| **3.4** | **Supprimer trois scripts de rapatriement devenus inutiles** | S | `06-rapatrier-carreaux.sh`, `07-carreaux-200m.sh` et `06-completer-tables-lourdes.sh` tirent tous les carreaux depuis une prod qui n'existe plus. ⚠ `docs/AUDIT_SEVESO_PPRT.md` cite encore le deuxième pour expliquer une mesure : effacer un script dont un document explique un résultat rend ce document incompréhensible. |
| **3.5** | **Trancher `app/api/radio/data/route.ts`** | S | Le fichier **n'est pas suivi par git** (motif `data/` du `.gitignore`) et porte un `DELETE` destructeur que `/admin/radio` appelle. Il marche ici et n'existerait nulle part ailleurs. Exception au `.gitignore`, ou retirer le bouton. |
| **3.6** | **Les constats R-21, R-25, R-27, R-28** | S | Gravité basse, aucun effet mesuré. Détail dans `docs/AUDIT_ZONE_RISQUE.md`. |

---

## 4. Ce qu'il ne faut pas re-découvrir

Quatre pièges rencontrés le 19/09, chacun ayant coûté du temps parce que **le
symptôme ne désignait pas la cause** :

- **Une sauvegarde peut contenir les données sans se restaurer.** La première
  portait les 569 698 lignes et rendait 568 197 « syntax error ».
  `\restrict` (PostgreSQL 17.6) bloque aussi le `\.` qui termine chaque bloc de
  données. D'où le format binaire, et d'où
  `scripts/local/10-sauvegarder.sh`, qui **restaure pour vérifier**.
- **Une suite de tests peut mentir.** Un test *différent* échouait à chaque
  exécution. La cause n'était pas la contention CPU mais une course entre Kong
  et PostgREST, visible **uniquement dans les journaux de Kong** — PostgREST
  n'en garde aucune trace.
- **Un `git checkout` peut casser un test.** `core.autocrlf = true` ajoutait un
  CR en fin de shebang, qu'esbuild refuse. L'erreur pointait une ligne de
  commentaire d'un fichier parfaitement valide. Corrigé par `.gitattributes`.
- **Un outil de diagnostic peut mentir aussi.** Mon test de détection des fins
  de ligne cherchait la lettre `r` au lieu de `\r`, et trouvait donc « usr »
  partout. Il a annoncé « CRLF » sur tous les fichiers, y compris après
  correction. Seul un comptage d'octets a tranché.

---

## 5. Où se trouve quoi

| Document | Contenu |
|---|---|
| `ARCHITECTURE.md` (racine) | **La seule source de vérité.** Jamais de second document d'architecture. |
| `docs/COUPER_SUPABASE.md` | L'audit de la coupure, la batterie de vérification, la sauvegarde |
| `docs/AUDIT_ZONE_RISQUE.md` | Les 28 constats, la baseline de comportement, les arbitrages |
| `docs/REFACTOR_ZONE_RISQUE.md` | Ce qui a été corrigé, ce qui reste, et pourquoi |
| `scripts/local/10-sauvegarder.sh` | Sauvegarde **et vérification** de la base locale |
