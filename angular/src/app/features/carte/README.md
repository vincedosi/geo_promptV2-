# carte — la carte principale

**Rôle** : portage de `/map` (lot 4), devenu un PARCOURS le 2026-10-13 — ① Périmètre › ② Données › ③ Zones ›
④ Analyse › ⑤ Jeu de zones › ⑥ Plan › ⑦ Activation › ⑧ Live, dans l'ordre du module risque (Vincent, 13/10 ; spec
§ 15 — sept étapes, ③ Analyse avant ④ Zones, jusqu'à la tâche 4c). La barre du parcours, puis la carte sur toute la largeur, avec le panneau
de l'étape courante qui FLOTTE au-dessus d'elle en haut à gauche et sa boîte à outils en haut à droite ; l'étape vit
dans `?etape=`. Le module risque s'y ouvre en surimpression.

**Route** : `carte` (`/app/carte`), plein écran, sœur de la coquille, `authGuard`. Son outlet enfant porte
`risques` (voir `features/risques/README.md`) : ouvrir puis fermer le module ne recrée jamais la carte.

**Entrée** : `carte.page.ts` (+ `.html`, sélecteur `mg-carte-principale`) — elle FOURNIT tous les services
d'état et de couche (`providers`) : ils naissent et meurent avec l'écran.

## Les sous-dossiers

| Dossier | Contenu |
|---|---|
| `parcours/` | la barre du parcours (`mg-barre-parcours` : fil d'Ariane, fil d'étapes, bouton « Autres » hors du fil, actions), le panneau d'étape (`mg-panneau-etape` : poignée, repli « carte seule »), l'étape « bientôt » qui reste (⑧) |
| `outils/` | la boîte à outils (`mg-boite-outils`, `OutilsCarteService` : Mes analyses, Mes zones, Fond de carte, Légende, Aide, Réglages ; un tiroir à la fois, dans la pile Échap ; contenu monté à la première ouverture puis gardé) |
| `panneaux/` | le contenu de chaque étape : `filtre/`, `calques/` (une section par couche, dépliée dans une ligne de ② ou dans « Autres »), `analyse/` (bataille d'isochrones, corrélation, score, clustering), `zones/` (création ; « Mes zones » et les jeux de zones, montés par l'outil Mes zones ; plan média), `autres/` (le panneau « Autres » : panneaux OOH et radio, hors du fil), `donnees/` (② « Données », T13 : `mg-panneau-donnees` — « Actifs », `mg-actions-poi`, « Chercher un jeu », données de l'espace, données communes recommandées, « Plus de données communes » — et la ligne uniforme d'un jeu, `mg-ligne-jeu`, T12) ; `aide` et `reglages`, contenus des tiroirs de la boîte à outils |
| `couches/` | une couche = un service (`*.service.ts` : état, lectures, pose) + ses fonctions pures (`couche-*.ts` : sources, couches, peintures, popups) |
| `etat/` | état de l'écran : `parcours.service.ts` (étape courante, étapes visitées, `?etape=`), `etat-carte.service.ts` (mode immersif, filtre, dégradé actif…), `couches-carte.service.ts` (registre des couches, `carteCourante`), pile Échap, annonces, zones, bataille, score…, `jeux-recommandes.service.ts` (la sélection recommandée de l'espace, lue une fois par ②, fourni par le panneau Données), `donnees-affichees.service.ts` (« affiché » pour ② : pastilles des lignes ET de l'étape, une seule source, fourni par la page) |
| `data/` | services d'API de la carte (`*.api.ts`) |
| `logique/` | fonctions pures : `parcours.ts` (les huit étapes, l'URL, les raccourcis), `jeux-carte.ts` (le registre des jeux) et `rangement-jeux.ts` (le rangement de ② : espace, recommandés, « Plus de données communes »), copies de la logique React (`palettes-donnees-carte.ts`, `carreaux/`, `meteo/`…, verrouillées par les tests `carte-*-paritaire`), ordre des couches, gardes, règles de la légende ; `focus-retour.ts` (le retour du focus sur l'hôte de la page — après la fermeture d'un tiroir, d'un dialogue, du module risque, ou un geste qui cache l'élément focalisé —, extrait de `carte.page.ts` le 2026-10-15 : des `effect` liés à l'injecteur de la page, aucun écouteur `window`/`document`) |
| `legende/` | la légende unique (`legende-carte`) et ses blocs propres (score, bataille, zones du profil) |
| `commun/` | annonce, choix du fond (`mg-choix-fond`, tiroir « Fond de carte ») |

## La navigation : le parcours (lot 1, 2026-10-13)

- **Où j'en suis** : `mg-fil-etapes` dans `mg-barre-parcours`, ou `Alt+1…Alt+8` (lus sur `KeyboardEvent.code`, pavé numérique
  compris, donc valables en AZERTY ; inertes sous le module risque et dans un champ de saisie). L'étape s'écrit dans `?etape=` par
  `ParcoursService` (`replaceUrl`, `merge`) ; ① n'est pas écrite. Pas un tunnel : chaque étape reste ouverte.
  `?etape=` porte un IDENTIFIANT (`perimetre`, `donnees`, `zones`, `analyse`, `jeu`, `plan`, `activation`, `live`),
  jamais un numéro : les liens d'avant le passage à 8 étapes restent valides, et il n'y a pas d'alias numérique.
  Le fil est COMPACT (`[compact]="true"`, conteneur `@container`) : une ligne par étape, et sous 640 px de conteneur (« Autres » compris ; `nav` compact sans écart, T11b ; 640 et non 630 depuis
  que ④ peut s'allumer, T14 : au pire, ①, ② et ④ renseignées, le conteneur demande 635 px)
  les étapes non courantes se replient en numéro (libellé en `sr-only` et en infobulle) — 1 440 px tout lisible (fil d'Ariane « France entière », badge super_admin long compris), 1 280 px replié.
- **« Autres »** (T11b, Vincent 14/10) : un bouton de la barre, juste après le fil et séparé de lui par un filet — au
  niveau des étapes mais HORS du parcours : ni numéro, ni `Alt+N`, hors de la liste `nav` des étapes (« Autres, hors
  parcours » pour le lecteur d'écran). Il ouvre `mg-panneau-autres` dans le cadre du panneau d'étape et s'écrit
  `?etape=autres` (l'étape d'en dessous ne change pas ; choisir une étape le referme ; `?etape=Autres` ou toute autre
  valeur inconnue est nettoyée comme d'habitude). Contenu : les sections Panneaux OOH et Radio, sorties de ② (on n'en
  construit pas de zones). « Panneaux OOH et DOOH » choisit une CAMPAGNE de l'espace (2026-10-16, spec
  ooh-campagnes § 6) : `CampagneOohService` (page) lit la liste à la première ouverture, puis la campagne choisie ;
  sa couche dédiée (`couches/couche-campagne-ooh.ts`, une teinte `--ligne-media-*` par ligne, anneau pointillé des
  points à vérifier, listés et cliquables dans la section) et sa fiche (`mg-fiche-emplacement-ooh`, à la place du
  tiroir Street View) ; la radio reste dans `RadioService`. Sections ouvertes : `SelectionsCalquesService` du panneau
  Autres, monté à la première ouverture puis gardé.
- **Où je regarde** : le fil d'Ariane de la barre, nourri par le filtre de ① ; « France entière » le retire.
- **Le panneau d'étape** (`mg-panneau-etape`) est une carte flottante `absolute` dans `[data-zone-carte]` : la carte
  garde toute sa largeur, `couches/marge-carte.ts` lui pose un `setPadding` pour que centrage et recadrages visent la
  partie que le panneau laisse libre. Poignée 320-900 px, repli « carte seule », largeur et repli jamais dans l'URL.
  Chaque panneau est monté à la PREMIÈRE visite de son étape puis gardé (`invisible` + `inert`) : revenir ne relit rien.
- **La boîte à outils** (`mg-boite-outils`) : Mes analyses, Mes zones, Fond de carte, Légende (bascule), Aide (celle de
  l'étape courante + raccourcis), Réglages (apparence, back office). Un tiroir à la fois, Échap le ferme.
- **Dans la barre** : « Script bidding DV360 » (lien `?customZone=` ; masqué aux étapes ⑥-⑧, la V1 n'y fait pas de
  custom bidding) et « Plan média (n) » quand ils ont un objet,
  « Tout effacer », mode immersif (sortie : bouton de la boîte à outils ou Échap), thème, session et espace.
- ⑤ Jeu de zones (lot 5) a son panneau (`panneaux/jeu/`, voir plus bas) : React n'a rien d'équivalent hors du module
  risque. ⑥ Plan (lot 6) a le sien (`panneaux/plan/`, voir plus bas), ⑦ Activation (lot 7) aussi
  (`panneaux/activation/`, voir plus bas). ⑧ affiche « Bientôt dans le parcours. »,
  avec un lien vers l'écran React si `urlApplicationReact` est posé — il porte la campagne courante (`&campaign=`, lu
  par le deep-link React) ; le sélecteur de campagne de la barre y écrit déjà `?campagne=`. Les outils de ③ et ④ n'ont pas bougé : rayons et isochrones comme types de zone de
  ③, couverture par territoire dans ④, c'est aux lots 4-5.
- **La pastille « renseignée »** d'une étape (`etatsEtapes`, `logique/parcours.ts`, table `RENSEIGNEE_PAR`) : ① un
  filtre posé, ② un jeu de ② affiché (`DonneesAfficheesService`, la même source que les pastilles des lignes ; ni OOH
  ni radio), ④ une analyse peinte — score composite, zones à risque, couverture, bataille, ou une analyse du panneau
  publiée au registre `AnalysesPeintesService` (couverture par rayon, typologies ; ④ finitions, T5), ⑤ une zone ou un jeu, ⑥ une stratégie
  existante pour la campagne courante (lot 6), ⑦ un lot `termine` ou `partiel` (donc non annulé) de la campagne
  courante, lu dans l'historique (lot 7, A-11). ⑧ ne s'allume pas encore.
- **Aucune fonction perdue** : le describe « aucune fonction perdue (spec § 12, lot 1) » de `carte.page.spec.ts`
  (`INVENTAIRE`) dit où vit chaque fonction de l'ancienne carte. Une ligne rouge = une fonction perdue : la rétablir.

## ② Données : les jeux rangés (lot 2, 2026-10-14)

- **Le panneau** `mg-panneau-donnees` remplace l'ancien « Calques » : « Actifs (n) », les actions POI, « Chercher un
  jeu », « Données de l'espace » (ses types de POI, ou « Cet espace n'a importé aucune donnée. »), « Données
  communes » (la sélection recommandée de l'espace) et, replié, « Plus de données communes (n) ». Sans sélection — ou
  une sélection qui ne désigne aucun jeu présent — tout est déplié et le repli n'existe pas. Dans chacune des deux
  listes communes, les types de POI de source commune (lycées, CIRFA…, sans liste écrite : la clé `poi:`) suivent les
  référentiels dans un sous-groupe repliable « POI communs (n) » (`decouperCommuns`, retours du 26/10, T6) : fermé par
  défaut, déplié par une case cochée ou une recherche, absent sans POI commun.
- **Les jeux** : `logique/jeux-carte.ts` (registre, copie de `lib/carte/jeux-carte.ts`) — 8 référentiels communs (IRIS,
  carreaux, indicateurs CP, transport, TMJA, ICPE et PPRT, santé, météo) plus les types de POI ; OOH et radio vivent
  dans `JEUX_AUTRES`, jamais dans ②. `logique/rangement-jeux.ts` les range ; la recherche filtre APRÈS le rangement.
- **La ligne** `mg-ligne-jeu` : nom, nature · maille, pastille « affiché », puis une case (type de POI — « Afficher
  les POI » reste un geste) ou un chevron qui déplie la section `integre` (en-tête masqué, contenu ouvert), instanciée
  seulement dépliée.
- **Ce que la première visite lit** : `GET /api/map/categories`, `GET /api/map/jeux-recommandes` et, depuis le lot
  « Catalogue et groupes » (A-7), le catalogue des indicateurs `GET /api/cibles/indicators` par
  `CatalogueIndicateursService` (fourni par la page, partagé avec ③ « Par seuil » et ④ : UNE lecture par page, testée
  dans `carte.page.spec.ts` — rien au montage sur ①, une à la 1ʳᵉ visite de ②, aucune de plus sur ③ et ④). Rien
  d'autre — aucun calque ni tuile avant un geste. La sélection se règle dans Accès › fiche espace › Données
  (`mg-jeux-recommandes`) ; une recommandation range, elle ne donne ni ne retire aucun droit.

### ② rangée par les droits, fiche d'un jeu (lot « Catalogue et groupes », T5-T6, 2026-10-28)

- **Un indicateur privable suit les droits de sa source** (sql/288 : ligne `data_sources` de type `indicateur`).
  `jeuxDeLaCarte(types, indicateurs)` (`logique/rangement-jeux.ts`) : un référentiel qui déclare des `indicateurs`
  (aujourd'hui `civique:indicateurs-cp` → `abstention_pres_2022`) est **retiré** si aucun n'est dans le catalogue,
  rangé dans « Données de l'espace » si l'un a `origine: 'espace'`, laissé dans les données communes sinon. Tant que
  le catalogue n'est pas arrivé, ou s'il échoue, la ligne reste (affichage seulement : la route ne sert de toute
  façon que les indicateurs visibles ; « pas de clignotement »).
- **Fiche** : chaque ligne porte un bouton « i » (`data-bouton-fiche`, « Fiche du jeu <nom> », `aria-expanded`,
  `aria-controls`) qui déplie `mg-fiche-jeu` (`panneaux/donnees/fiche-jeu.component.ts`) sous la ligne :
  « Propriétaire · Niveau · Effectif · Importé le » par source, ou « Socle dentsu.explore, référentiel système ».
  `GET /api/map/catalogue/fiche?cle=` à la PREMIÈRE ouverture seulement, puis `CacheFichesJeu` (fourni par ②, survit
  à une ligne détruite par la recherche ou le repli « POI communs ») ; fermée = aucune lecture ; 404 → « Ce jeu n'est
  plus disponible dans cet espace. » ; autre échec → message et « Réessayer ».
- **Écart React (assumé, fichiers gelés non modifiés)** : React reçoit le même catalogue filtré par
  `GET /api/cibles/indicators` (il ignore `origine`), mais sa section civique propose l'abstention en dur
  (`app/map/_components/filter-panel/CivicIndicatorsSection.tsx`) : dans un espace qui ne la voit pas, la choisir fait
  répondre `GET /api/insee-variables/abstention_pres_2022/geojson` en 404 (comme un code inconnu) et
  `CivicIndicatorsLayer.tsx` tombe dans son état d'erreur — échec journalisé en console, rien n'est peint. Aucune
  valeur ne fuit : le refus est serveur.
  Second écart, côté administration : `/api/admin/sources` rend désormais la ligne de type `indicateur`, que
  `typeBadge` (`app/admin/sources/_components/ui.tsx`) ne connaît pas — la page Sources React l'affiche « Carreaux
  INSEE ». Libellé faux, aucune fuite ni casse (la suppression répond 409) ; Accès (Angular) la nomme « Indicateur ».
- **Dupliqué par construction** (React / Angular, verrouillé par parité, jamais factorisable entre les deux
  applications) : le type `TypeJeu` (`'panneaux' | 'poi' | 'carreaux' | 'indicateur'`, `espaces-types-paritaires`)
  le registre `JEUX_REFERENTIELS` avec son champ `indicateurs` (`jeux-carte-paritaire`), et la forme de la fiche
  (`FicheJeu`, `SourceFicheJeu`, `NiveauSourceFiche` de `data/carte.api.ts` ↔ `lib/carte/fiche-jeu.ts`,
  `fiche-jeu-types-paritaires`, ajouté en T6).

## ③ Zones à recette : la plomberie (lot 3, T9, 2026-10-15)

- **L'API** `data/zones.api.ts` (`ZonesApi`, dans `FOURNISSEURS_DISTANTS`) : `apercu` (`POST /api/zones/apercu`, rien
  d'écrit), `enregistrer` (`POST /api/zones`, réponse COMPLÈTE : 200 ou 207) et `recalculer` (`POST
  /api/zones/[id]/recalculer`). `ZoneCustomResume.recette` porte la recette lue par `/api/custom-geo/list`.
- **Le périmètre** : `logique/zones/perimetre-recette.ts` — `perimetreDeFiltre` (le filtre de ① tel qu'une recette
  l'enregistre ; la France s'écrit `FR`, aucun filtre → `null`, refusé avant tout appel pour une recette lourde) et
  `messageErreurZone` (le message français de la route, sinon un message par statut).
- **L'import** : `logique/zones/import-forme.ts` — `lireForme(texte, nomFichier)` lit un GeoJSON ou un KML (préfixé ou
  non, `DOMParser`) en un `MultiPolygon` : polygones gardés, points et lignes COMPTÉS comme ignorés, refus au-delà de
  20 000 sommets et sur des coordonnées hors bornes ou lat/lon inversées (dit, jamais corrigé). La réparation et le
  découpage sur la France restent au serveur.
- **L'atelier** : `etat/atelier-zone.service.ts` (`AtelierZoneService`, fourni par `mg-panneau-zones`, qui reste
  monté — l'aperçu survit à ③ → ① → ③) : `apercevoir(recette, geometrie?)` coupe l'aperçu précédent ; `enregistrer(nom)`
  envoie la RECETTE (la géométrie seulement pour une forme figée). ⚠ `POST /api/zones` n'est PAS idempotent : une
  écriture en vol n'est jamais coupée ni doublée (second clic, nouvel aperçu, « Effacer » ignorés jusqu'à la réponse),
  et un 207 est une réussite (la zone existe : atelier vidé, jamais renvoyée, son `message` affiché). Une réponse
  PERDUE (statut 0) ou un 2xx sans `zone_id` vident aussi l'atelier — la zone existe peut-être — et disent « La réponse
  n’est pas arrivée : vérifiez Mes zones avant de réessayer. » ; un refus HTTP garde l'aperçu (`messageErreurZone(e,
  'Enregistrement impossible.')` : le défaut se choisit par geste). Piste de chargement `atelier-zone` :
  la page fournit `ChargementService` et monte `mg-barre-progression` sous la barre du parcours.
- **La couche** : `couches/apercu-zone.ts` (`apercu-zone-fill` / `apercu-zone-line`, au-dessus de l'aperçu du rayon
  dans `logique/ordre-couches.ts`), teal 0,15 et contour pointillé `[2, 2]` ; pose et retrait communs avec l'aperçu du
  rayon dans `couches/apercu-forme.ts`.

## ③ Zones par familles (lot 3, T10, 2026-10-15)

- **Le panneau** `panneaux/zones/panneau-zones.component.ts` : la ligne du périmètre de ① en tête, puis quatre familles
  `mg-entete-section` repliables, dans l'ordre « Autour des POI » (ouverte : rayon autour d'un point, rayon autour d'un
  type de POI) · « Par seuil » (carreaux 200 m ; IRIS ou codes postaux) · « À la main » (dessin, import GeoJSON / KML,
  liste de codes postaux) · « Capture » (le bouton existant, libellé inchangé), puis `mg-pied-recette` et le renvoi
  vers « Mes zones ». Fournit `CreationZoneService` et `AtelierZoneService` ; `CatalogueIndicateursService` est fourni
  par la PAGE (revue finale, X4 : une lecture partagée par Analyse, ③ et « Mes zones »). Une famille
  repliée démonte ses formulaires (aucun calcul n'y vit) ; replier « À la main » pendant un tracé rend la carte.
- **Les quatre formulaires** (`recette-rayon-poi`, `recette-seuil-carreaux`, `recette-seuil-territoire`,
  `recette-import`) ne font que COMPOSER : un signal `recette` (`null` tant que leur garde refuse — aucun périmètre,
  France, région pour les carreaux, catalogue indisponible, fichier refusé) et leur texte de garde `[data-garde]`.
  Styles communs : `styles-recette.ts`. Aucune lecture à l'ouverture de ③ : les types de POI viennent du catalogue de
  la page (`chargerUneFois`), le catalogue d'indicateurs n'est lu qu'à l'ouverture de « Par seuil ». Les deux
  formulaires de seuil lisent leur champ par `logique/zones/lire-seuil.ts` (`lireSeuil` : vide → `NaN`, jamais 0).
  L'import KML resserre les virgules espacées (« 5, 43 ») avant de découper les tuples. L'import refuse un
  fichier de plus de 5 Mo AVANT de le lire (`TAILLE_MAX_IMPORT_OCTETS` : un parse de 100 Mo fige l'onglet).
- **Le pied** `mg-pied-recette` (arbitrage P4), monté une fois : reçoit la recette du formulaire ACTIF (le dernier
  touché, ou le premier d'une famille qu'on ouvre ; liseré teal), porte « Aperçu », les chiffres de l'aperçu
  (`formaterNombre` : surface, carreaux / POI / territoires, habitants ; part dans le périmètre sous `PART_SIGNALEE`,
  une PART — 0,98 — exportée par `logique/zones/creation-zone.ts` et partagée avec les créateurs), le nom (le libellé
  de la recette par défaut, réinitialisé quand la recette prévisualisée change ; le catalogue arrivé après coup ne
  remplace qu'un nom non touché) et « Enregistrer la zone ». Enregistrer est inactif dès le premier clic et tant que
  l'aperçu n'est plus celui du formulaire actif (réglages changés, formulaire disparu, autre fichier) ; « Effacer » l'est pendant un calcul ; un 207 n'est jamais renvoyé — si la
  recette se recalcule, « Mes zones » est proposé.
- **Les créateurs du lot 4 et les opérations écrivent une recette** : `CreationZoneService.creer(source, nom, recette)`
  écrit par `POST /api/zones` (codes postaux → `codes_postaux` avec les codes retenus par la route source ; rayon →
  `rayon_point` ; dessin → `dessin` avec sa géométrie réparée ; « Créer la zone » du score composite → `capture` de
  source `score` avec sa géométrie — la géométrie ne part que pour une forme figée, `exigeGeometrie`). Après un 207,
  le message de création dit l'avertissement de la route (`IssueCreation.avertissement`) au lieu de « 0 codes
  postaux ». Les opérations de « Mes zones » écrivent `combinaison` en UN appel (« Restreindre à » actif à deux zones
  exactement) ; un 207 y est une réussite (`termine` : liste relue, sélection vidée, message de la route). Une
  combinaison n'est PAS recalculable (ses opérandes sont figés ; arbitrage de la revue finale, pas de « Dupliquer »
  dans ce lot). Une zone citée (`zone_referencee`) ne se supprime pas (409).
  `CreationZoneService.org` reste lu par la capture.
- **La capture garde sa recette ; isochrones et bataille restent en ④ (T11, arbitrage C3 / L3-5)** : rien n'est retiré
  de ④. `mg-capture` ajoute au corps de `POST /api/custom-geo/capture` une recette FIGÉE (`recetteCapture`) —
  `isochrone` quand la SEULE couche capturée est une bataille à POI, ses `parametres` étant les clés scalaires de son
  enrichissement (`cache_key`, `category`, `mode`, `poi_count` : la métadonnée de la couche ne porte ni `minutes` ni
  `version`) plus `paliers` joints en chaîne (« 5,10,15 ») ; les POI restent dans `source_metadata` et les
  sous-zones. `cache_key` n'est qu'une PROVENANCE (le cache peut être purgé ; la recette ne se rejoue pas). Une
  bataille SANS POI retombe sur `capture` (`source_type` `isochrone_battle`), une capture MIXTE (bataille + autre
  couche) aussi (`capture` de `source_type` `composite` : sa forme n'est pas que des isochrones) ; toute autre capture
  devient `capture` avec son `source_type`. Un 207 de la route (`recette_non_enregistree`,
  `zone_created_but_resolution_failed`) affiche son `message` dans `[data-avertissement]` et le dialogue reste ouvert. « Autour des POI » porte le renvoi `[data-renvoi-analyse]` et « Aller à ④ Analyse »
  (`ParcoursService.choisir('analyse')`) ; ③ ne monte ni `mg-outil-isochrones` ni `mg-outil-bataille-v2`.

## « Mes zones » : la recette et « Recalculer » (lot 3, T12, 2026-10-15)

- **La carte d'une zone** (`panneaux/zones/carte-zone.component.ts`) : une ligne `[data-recette]` — la recette en clair,
  « Forme figée » pour une zone d'avant le lot 3 — qui passe à la ligne plutôt que d'être tronquée. Pour une zone à
  recette, la ligne de composition (`decrireComposition`, copie React, qui ne lit que `source_metadata` et rendait
  « recette_codes_postaux ») disparaît, et la puce de source prend le libellé du type (`[data-source]`). « Recalculer »
  (`[data-recalculer]`, sortie `recalculer`) seulement si `estRecalculable` ; désactivé par `recalculEnCours`, distinct
  d'`enCours` (lecture de la géométrie, qui fait dire « Chargement… » à « Afficher »).
- **Les libellés** : `logique/zones/libelle-zone.ts` COMPLÈTE la copie verrouillée `source-type-labels.ts` —
  `libelleSource` (puces et ligne de source : les `recette_*` posés par `creer_zone_recette` ont un libellé, le reste
  passe par la table de React). Le libellé d'une recette est `libelleRecette(r, indicateurs?)` de `recette.ts` (copie
  paritaire du serveur, revue finale X1) : le seuil mis en forme par `formaterNombre` (« 20 000 », « 12,5 ») et, pour
  un seuil sur territoires, le LIBELLÉ du catalogue et son unité (sans catalogue, l'identifiant).
- **Le recalcul** (`mes-zones.component.ts`) : `ZonesApi.recalculer(id)`, une fois par zone à la fois (second clic
  ignoré), puis la liste est relue et la zone, si elle est affichée, redessinée (géométrie relue). Un 207 est une
  réussite, dit dans `[data-avis]` (le `message` de la route, « Zone recalculée, mais … » ; repli nommant la zone),
  jamais renvoyé. Un échec dit le message de la route dans `[data-erreur]` (409 « utilisée par un plan, un jeu de
  zones ou une autre zone », 409 forme figée — combinaison comprise —, 422…) et ne touche pas à la liste : un 404 peut
  venir d'une zone MEMBRE supprimée d'une combinaison.
- **La suppression refusée** (409 `zone_referencee`) affiche le message français de la route dans le dialogue, plus
  « HTTP 409 » (`messageErreurZone`, le message par statut de React en défaut).
- **Le catalogue d'indicateurs** : celui de la PAGE (X4), partagé avec ③ et Analyse ; « Mes zones » ne le lit QUE si
  un seuil sur territoires est listé.

## ③ Finitions (plan `2026-10-29-carte-en-parcours-zones.md`, T1-T7, 29-30/10/2026)

- **La bataille V2 se capture de nouveau** (T4, A-1) : `BatailleV2Service.terminer` pose `cle: battleCacheKey` ; le
  renvoi de ③ dit « La bataille d’isochrones se lance à l’étape ④ ; capturez ensuite son résultat ici. ». Les anneaux
  V2 sont des BANDES disjointes (`ST_Difference`) : la sous-zone d'un POI porte toutes ses bandes (`geometries`), que
  `/api/custom-geo/capture` unit côté base (preuve T7, D-1 : 25 130 km² de sous-zones = la zone, 1 799 IRIS · 345 CP).
- **« Dupliquer »** (T5, A-5) : `ZonesApi.dupliquer(id, nom)` → `POST /api/zones/[id]/dupliquer`, sur toute zone de
  « Mes zones » ; après un 409 `zone_referencee`, le bouton devient « Recalculer dans une nouvelle zone ». Une recette
  recalculable est exécutée À NEUF, une forme figée est copiée en base (`dupliquer_zone`, sql/294) ; la source n'est
  jamais écrite. Non idempotent : bouton inactif dès le premier clic, statut 0 → « vérifiez Mes zones ».
- **Plus de script de custom bidding** dans la carte d'une zone (T5, A-7) ; « Exporter TikTok » reste.
- **Le score composite garde sa provenance** (T5, A-6) : `recette.parametres = { indicateurs, maille, seuil_score }`,
  recette figée.
- **Seuil sur carreaux : « Carreaux d'au moins N ménages »** (T6, A-3) : 11 par défaut pour une nouvelle recette
  (`parametres.min_menages`, absent = 0 pour les zones d'avant), dit dans `libelleRecette` ; RPC
  `zone_seuil_carreaux_min` (sql/292).
- **L'atelier recadre et efface son message** (T6, A-8, A-9) : un aperçu reçu recadre la carte sur son emprise (marge
  du panneau, zoom ≤ 14), pas un aperçu identique ; le message de réussite s'efface au changement de formulaire, de
  famille ou de recette.
- **Les 93 CIRFA** de `geography_zones` sont dans « Mes zones » de la Marine nationale (T3, sql/293), formes figées,
  sans codes résolus (« 0 IRIS · 0 CP »).
- **Écarts à React (gel P5, non corrigés)** : React ne capture pas la bataille V2 ; il garde le bouton de script de
  custom bidding ; il n'a ni « Dupliquer » ni le minimum de ménages (sa route `indicator-threshold` est inchangée) ;
  sa capture (`/api/custom-geo/capture`) et sa sauvegarde (`/api/custom-geo/save`) écrivent `created_by = NULL`
  (D-3 ; `POST /api/zones` et `…/dupliquer` le renseignent) ; son dialogue de capture garde ses libellés sans accents
  ni sentence case (D-7, corrigé côté Angular seulement) ; il n'a pas d'import GeoJSON / KML. Il affiche aussi les
  `source_type` neufs en brut (« recette_capture »…) dans « Mes zones ».

## ④ Analyse : la zone analysée (lot 4, T7, 2026-10-22)

④ chiffre UNE zone enregistrée de l'espace, sur sa forme telle quelle ou découpée par code postal ou par IRIS
(`GET /api/zones/[id]/couverture`), sans jamais la convertir. T7 pose la plomberie ; l'écran est T8.

| Fichier | Rôle |
|---|---|
| `data/couverture.api.ts` | `CouvertureApi` (dans `FOURNISSEURS_DISTANTS`) : `couverture(zoneId, cible, decoupage)` |
| `logique/analyses/couverture.ts` | PUR, sans import d’Angular (le test de parité racine l’importe) : types de la réponse, copie de `DECOUPAGES` et des messages de refus (`couverture-paritaire.test.ts`), paramètre d’URL, tri, pagination (50), libellés, résumé ; les messages d’une erreur HTTP sont dans `couverture-erreurs.ts` |
| `etat/zone-analysee.service.ts` | `ZoneAnalyseeService`, fourni par la PAGE (`carte.fournisseurs.ts`) : `zoneId`, `cible`, `decoupage`, `resultat`, `enCours`, `erreur` ; `choisir`, `regler`, `chiffrer` |
| `etat/ecrire-parametres.ts` | Le SEUL écrivain de paramètres d'URL de la carte (piège P-g) : part de la navigation EN VOL et de SON arbre d'URL ; avec un `chemin`, ouvre un module (page d'historique) — `ParcoursService`, `ZoneAnalyseeService`, `LienZoneService`, `CarteHoteComponent`, `section-risque`, `jeux-de-zones` |
| `panneaux/analyse/choix-zone-analysee.component.ts` | `mg-choix-zone-analysee` : liste des zones de l'espace lue au PREMIER clic, filtre par nom, zone choisie (nom, recette, « Changer », « Retirer ») ; sortie `choisie` |

- **URL** : `?zoneAnalyse=<uuid>` et `?couverture=<cible>.<forme|cp|iris>` (défaut `ind.forme`, non écrit) — lus à
  la construction, réécrits en `replaceUrl`, relus à toute navigation extérieure ; une valeur illisible est réécrite
  une fois. Indépendant du filtre ① et de `?customZone=` (le créneau de bataille, que `LienZoneService` retire après
  lecture).
- **Aucun appel avant « Chiffrer »** ; changer de zone, de cible ou de découpage efface le résultat et ANNULE la
  requête en vol ; chaque chiffrage porte un jeton, une réponse quittée est jetée. 404 `zone_introuvable` (zone
  supprimée, ou d'un autre espace — lien partagé) : `?zoneAnalyse=` retiré, message affiché.
- **P-g** : `queryParamsHandling: 'merge'` fusionne avec la dernière URL ABOUTIE ; deux navigations du même tick et
  la seconde efface le paramètre de la première. `ecrireParametres` part de la navigation EN VOL
  (`router.currentNavigation()`) et navigue sur SON arbre (jamais l'ancien chemin) ; tous les écrivains de la page
  passent par lui (vague finale du lot 4, `ecrire-parametres.spec.ts`).

### L'écran et la couche (T8)

| Fichier | Rôle |
|---|---|
| `panneaux/analyse/outil-couverture.component.ts` | `mg-outil-couverture`, EN TÊTE de ④ et ouvert par défaut : zone (`mg-choix-zone-analysee`), cible (catalogue `ProfilRisqueApi.cibles()` lu à la première ouverture du sélecteur, ou pour nommer une cible venue de l'URL), découpage (« Telle quelle » · « Par code postal » · « Par IRIS »), CTA « Chiffrer la zone », refus au-dessus du CTA, trois chiffres clés, tableau, « Calculé le … · en cache » |
| `panneaux/analyse/tableau-couverture-zone.component.ts` | `mg-tableau-couverture-zone` : Territoire · Dans la zone · Total · Part (barre `--seq-*`) ; tri par colonne, 50 lignes par page, « 5 498 IRIS · page 3 sur 110 » ; survol → surbrillance sur la carte |
| `couches/couverture.service.ts` | `CouvertureService` (PAGE, `carte.fournisseurs.ts`) : lit le contour de la zone (`/api/custom-geo/[id]/geometry`) et les contours CP (`ContoursZonesService`) au PREMIER résultat qui les demande, recadre (padding 60), re-pose au changement de fond, repeint au thème, retire au changement de zone et à la destruction ; « Tout effacer » masque jusqu'au chiffrage suivant |
| `couches/couche-couverture.ts` | Fonctions PURES : contour de la zone ; CP = contours filtrés aux codes de la réponse, `step` sur `part` en cinq classes (< 20, 20-40, 40-60, 60-80, ≥ 80 %) ; IRIS = couche sur `iris-source` avec `minzoom` 9 ET filtre `niveau = 'iris'` (les tuiles servent des communes sous z9), `match` sur `code_iris` GROUPÉ par classe ; surbrillance par `setFilter` |

- **Q-J** : « Population des carreaux Filosofi 2021 (63,78 M en France) » est la note du chiffre de tête ET la
  phrase sous le résultat, dans les trois découpages (`phraseReference`). Zone en Guadeloupe, Guyane ou Mayotte
  (`motif_vide = territoire_non_carroye`) ou en mer (`aucun_carreau`) : un message, jamais « 0 ».
- **Hors garde de ①** : la zone est le périmètre ; bornes et quota côté serveur (verrou
  `panneau-analyse-garde.test.ts`). A-9 : zone analysée → « Cet outil travaille sur le périmètre de l'étape ① » dans
  « Analyse spatiale » (batailles) et au-dessus du clustering.
- **Ordre** : `couverture-*` au-dessus des zones enregistrées, sous les points OOH et les tracés (`ORDRE_COUCHES`).
- **Un seul dégradé** (correctif de revue, Q1) : `'couverture'` est au registre (`logique/degrades.ts` et sa source
  React, écart P5 ratifié) ; peinte, la couche évince l'IRIS, les carreaux, le score… ; évincée ou « Tout effacer »,
  elle se masque et le panneau dit « Couche retirée de la carte » + « Afficher sur la carte » (Q2), sans re-chiffrer.
- **Contour à jour** (I1) : la réponse porte `zone_maj` (sql/270) ; le contour est relu quand (zone, `zone_maj`)
  change — un recalcul en ③ redessine la nouvelle forme.
- **Lisibilité en clair** (I2, I3) : trait `--text-tertiary` sur les territoires touchés (le palier `--seq-1` est
  quasi blanc), pastilles et barres bordées ; texte d'avertissement `TEXTE_AVERTISSEMENT` (`styles-analyse.ts`).
- Pastille « renseignée » de ④ : `suivreAnalyseAffichee()` (`carte.fournisseurs.ts`) — score, zones à risque ou
  couverture peints.

### Ce que le lot 4a laisse en l'état (T9, 2026-10-22)

- **Deux chiffres pour une zone (A-15)** : le plan média des zones (`panneaux/zones/plan-media.component.ts`,
  `plan-media.service.ts`) lit `audience_stats` — carreaux qui INTERSECTENT la zone, ≤ 5 000 km² — quand ④ compte
  ceux dont le CENTROÏDE est dedans. Sur « CIRFA BRETAGNE » : 1 373 227 contre 1 355 354 habitants (+1,3 %).
  Unifier relève du lot 7 ; ne pas afficher les deux côte à côte d'ici là (`ARCHITECTURE.md`, § Zones custom).
- **La cible d'URL** (Q3 de T8, ratifiée) : le catalogue des cibles est lu à la première ouverture du sélecteur,
  ET au chargement quand `?couverture=` porte une cible autre que la population totale (il faut la nommer).
- **Couverture par rayon (4b, Q-I)** : bornée au département ; la région attendra un pré-calcul national.

## ④ Analyse : les analyses sur la zone analysée (lot 4b, 2026-10-23)

| Fichier | Rôle |
|---|---|
| `etat/lecture-annulable.ts` | `LectureAnnulable` : LE cycle des lectures de ④ (jeton + désabonnement + `DestroyRef`, P-c) — `lancer`, `chargerUneFois` (une lecture par propriétaire, un échec se relit), `refuser` (message sans requête), `annuler`, `perimer` ; `surChangement` (P-a) |
| `etat/score-composite.service.ts` | Le score part sur la zone analysée par défaut (`surZone`, T10) ; `corpsScore` prend `{ filtre } \| { zone }` ; fermer le panneau pendant un calcul l'annule |
| `etat/couverture-rayon.service.ts` | Couverture par rayon autour de TOUT type de POI (T12, `GET /api/analyses/couverture-rayon`) : catalogue de ② + sites ICPE ajoutés une fois le catalogue lu ; zone analysée introuvable (404) → retirée comme pour la couverture, le message reste ; état exposé en lecture seule |
| `couches/couche-couverture-rayon.ts` | POI et cercles au rayon lu sur la courbe (cercles bornés à `APERCU_SITES_MAX`) |
| `panneaux/analyse/outil-rayon.component.ts` | `mg-outil-rayon` : type, rayon maximal, détail par sous-catégorie, anneaux, cible, « Sur » ; la courbe `mg-courbe-population` du module risque |
| `panneaux/analyse/entete-outil.component.ts`, `pastilles.component.ts` | `mg-entete-outil` (en-tête des quatre outils d'accordéon) et `mg-pastilles` (groupe exclusif : découpage, détail par champ, « Sur ») |

- **Retiré le 2026-10-26 (retours du 26/10, T5)** : le bloc « Dans cette zone » de T13 (`mg-croisements-zone`,
  émetteurs radio dont la couverture touche la zone, comptages routiers qui la traversent), son état dans
  `ZoneAnalyseeService`, l'appel de `CouvertureApi`, la route `GET /api/zones/[id]/croisements` et ses tests. La RPC
  `croisements_zone` (sql/273) reste en base : `sql/284_retrait_croisements_zone.sql` est ÉCRITE mais NON APPLIQUÉE
  (d'autres worktrees montent encore ④ avec ce bloc). Elle s'applique au merge dans `feat/angular-lot0`, en même temps
  que le retrait de l'entrée `croisements_zone` de `types/database.types.ts` (types générés : ils suivent la base).
- **Bornes sous verrou** : `RAYON_MIN_M`, `RAYON_MAX_M`, `MAX_VALEURS`, `MAX_CARREAUX_COUVERTURE` sont copiés de
  `lib/zones/couverture.ts` dans `logique/analyses/couverture.ts` ; `couverture-paritaire.test.ts` compare les deux
  copies ET les nombres écrits dans sql/269 et sql/272.
- **Une phrase par refus** : `zone_introuvable` = « Zone introuvable dans cet espace. » partout (recettes, couverture,
  rayon). Sur la zone analysée, le rayon dit « La zone analysée dépasse 12 000 km² », pas « l'étape ① ».
- **Ce qui reste dupliqué** : l'en-tête « Analyse spatiale » du panneau (un accordéon de section, pas un outil) garde
  son gabarit. Les pastilles « Haut = mieux / Bas = mieux » du score et son catalogue sont factorisés depuis les
  finitions de ④ (T5 : `mg-pastilles`, `LectureAnnulable.chargerUneFois`).

## ④ Finitions (plan `2026-10-30-carte-en-parcours-analyse.md`, T5-T8, 30/10/2026)

| Fichier | Rôle |
|---|---|
| `etat/analyses-peintes.ts` | `AnalysesPeintesService` (page, `FOURNISSEURS_ANALYSE`) et `publierAnalysePeinte` : le registre des analyses peintes par un service du PANNEAU (couverture par rayon, typologies), lu par la pastille de ④ (A-8). La bataille peinte (`BatailleService.peinte`) l'allume aussi — pas la zone ouverte par `?customZone=` (catégorie `custom_geo_zone`, clé `cg__`), qui n'est pas une analyse (relecture 2) |

- **Score sur une zone introuvable (T5, A-2)** : le 404 `zone_introuvable` de `POST /api/analyses/score` passe par
  `ZoneAnalyseeService.siIntrouvable` (la zone quitte ④) ; le message reste affiché.
- **Zone nationale (T6, A-3, A-4)** : `panneaux/zones/creer-pays.component.ts` (`mg-creer-pays`, famille « À la main »
  de ③) écrit `{ v: 1, type: 'pays', code: 'METRO' | 'FR' }` par `POST /api/zones` — deux boutons inactifs dès le premier
  clic, 207 = réussite, réponse perdue → « vérifiez Mes zones » (en `role="alert"`). Une zone pays du même code déjà
  dans « Mes zones » grise son bouton avec la raison : la liste est lue au montage (premier dépli de « À la main »,
  jamais à l'ouverture de ③) et relue à chaque `revisionZones` (relecture 2). En ④, `mg-outil-couverture` reconnaît la zone pays à sa
  RECETTE (la ligne `lue` de `mg-choix-zone-analysee`, aucune lecture de plus) : « Par IRIS » y est inactive
  (`mg-pastilles [inactives]`) avec la phrase `decoupage_trop_fin_pays`, et « Chiffrer » ne part pas sur IRIS.
- **Bataille V2 sur la zone (T7, A-6)** : `BatailleV2Service.surZone` (bascule `mg-choix-sur-zone` dans
  `mg-outil-bataille-v2`, défaut = la zone quand il y en a une) ; `zoneBataille` → corps `parametresV2Zone`
  (`zone_id`, aucun filtre de ①), sans comptage de capacité. La garde du panneau (`zoneDeLOutil`) laisse passer la
  bataille sur la zone sans filtre ①, et la ligne A-9 ne s'affiche plus pour elle. Changer de zone abandonne la
  bataille en vol ; un 404 `zone_introuvable` (corps texte du flux, relu) retire la zone. Sur la zone, « Vérifier
  cache » et le remplissage ORS restent sur ① et sont inactifs (route de remplissage propre à la V2 : n° 44). Sur une
  zone pays (`zonePays`, recette lue sans requête), « Lancer » est inactif avec la phrase de la route (relecture 2).
- **Typologies des POI (T8, A-7)** : `etat/typologies-zone.service.ts` (`TypologiesZoneService`, panneau) et
  `panneaux/analyse/typologies-zone.component.ts` (`mg-typologies-zone`, tiroir `typologies` du jeu de ④, pour TOUS) :
  `CouvertureApi.typologies` lu au premier dépli, une fois par (zone, version — `ZoneAnalyseeService.ligne`, posée
  depuis la liste que `mg-choix-zone-analysee` lit déjà ; rien n'est lu tant qu'elle est inconnue) ; « Tout effacer »,
  tiroir ouvert, relit ; un tableau par (durée, mode) ; couche
  `couches/couche-typologies.ts` (`couverture-typologies-poi` / `-survol`, teintes `--nature-*` calculées), retirée au
  `DestroyRef` du service ; publiée au registre de la pastille. Le super admin garde `mg-section-clustering` dessous.
  La colonne s'appelle « Population cumulée », avec sa phrase sous le tableau (`MESSAGE_POPULATION_CUMULEE`) : c'est la
  SOMME des populations couvertes par les POI, recouvrements compris (68,8 M au modèle 60 min, plus que la France ;
  preuve T9, O-1). Le calcul est inchangé.

### ④ Finitions : ce qui est livré, écarts à React (T9, 30/10/2026)

Q-1 à Q-7 ont été tranchés par Vincent le 30/10 : les recommandations sont acceptées, et Q-5 va plus loin (le Voronoï
est supprimé partout).

**Livré** (preuve navigateur T9, deux thèmes, `rapport-preuve-T9.md` du registre) :
- le score sur une zone prend les CP de la couverture (`codes_postaux_de_zone_jsonb`, sql/295). Une zone rurale de
  2 km n'est plus « vide » ;
- les zones « France métropolitaine » et « France entière » se créent en ③ et se chiffrent en ④ sans lire de carreau
  (sql/296) : par CP, 5 956 CP ; « Telle quelle », 62 528 975 habitants ; l'IRIS est refusé avec sa phrase. L'export
  d'une zone pays répond 422 `zone_pays` ;
- la bataille V2 « Sur : la zone analysée » (`poi_de_zone`, sql/297) ;
- le tiroir « Typologies des POI » pour tous (`typologies_de_zone`, sql/298). Le calcul reste au super admin ;
- la pastille de ④ dit vrai ; une zone créée en ③ apparaît dans le choix de ④ sans recharger (D-1).

**Écarts à React** (gel P5) :
- React n'a ni la couverture d'une zone, ni la zone pays, ni la bataille sur une zone, ni le tiroir des typologies ;
- React reçoit la règle serveur de T1 : le score sur un filtre zone prend les CP de la couverture ;
- **Voronoï supprimé partout** (Q-5, `287b05ed`) : routes `/api/voronoi` et `/api/custom-geo/source/voronoi`, outil
  et calques React, garde `'voronoi'`, fonctions `get_voronoi_*` (sql/299). L'intro React « Analyses spatiales
  disponibles » ne l'annonce plus (`ce21b195`, gel levé pour ce point). Une analyse `voronoi` enregistrée répond 410
  au rejeu.

**Corrélation** (Q-6) : elle reste en ④ et déménage en ⑧ Live quand ⑧ sera livré.

**Résidus** (liste « Suites » du plan) :
- libellés de typologies sans accents (données du script Python) ;
- « Script bidding DV360 » dans la barre via `?customZone=` (à confirmer) ;
- D-4, le journal de bataille qui reste affiché au changement de zone (arbitrage) ;
- D-5, la casse des boutons de la bataille, identique à React (parité, à trancher une fois).

## ⑤ Jeu de zones : l'état (lot 5, T9, 2026-10-24)

⑤ traduit UNE zone enregistrée dans la maille de chaque plateforme d'achat et dit ce que la traduction perd. T9 pose
la plomberie ; l'écran est T10, la couche T11.

| Fichier | Rôle |
|---|---|
| `data/jeux.api.ts` | `JeuxApi` (dans `FOURNISSEURS_DISTANTS`) : registre des plateformes, jeux de zone (lister, lire, enregistrer, régler, supprimer, extraire, extractions), pavage en cercles, contours des communes. La conversion territoriale reste `CouvertureApi.couverture` (lot 4). Recouvre en partie `JeuxZonesApi` du module risque (déclaré dans l'en-tête) |
| `logique/jeu/conversion.ts` | COPIE de `lib/zones/conversion.ts` : corps identique mot pour mot, verrouillé par `tests/unit/angular/conversion-paritaire.test.ts` (corriger un côté = corriger l'autre) |
| `logique/jeu/plateformes.ts` | `PLATEFORMES`, `MAILLES`, `PlateformeGeo` (copie de `lib/zones/plateformes.ts` sans Zod, même verrou). Aucune limite de plateforme dans `logique/jeu/**` (grep du même test) |
| `logique/jeu/mailles-url.ts` | `?mailles=` (A-10) : `lireMailles` / `ecrireMailles` (ne lèvent jamais), `lireVersion` (`?x=`), `rayonParDefaut`, `SEUIL_PAR_DEFAUT` (20 %) |
| `logique/jeu/bilan.ts` | PUR : la lecture qu'un choix requiert (`lectureRequise`), la clé d'une couverture en mémoire (`cleCouverture`, date de mise à jour de la zone comprise), `rangerCouverture` (une autre version de la forme, `zone_maj`, purge les entrées de la même zone), `bilanDe`, `parPlateforme`, type `ResultatCercles` |
| `etat/file-lectures.ts` | `FileLectures` : les conversions UNE à la fois ; une tâche de même clé remplace la précédente (désabonnée, jeton) ; vidée au changement de zone et à la destruction |
| `etat/jeu-zones-taches.ts` | `TachesJeu` (⑤ finitions, T0) : la file des conversions (`FileLectures`), l'échec de chaque tâche par clé, le pavage déjà demandé par plateforme (`paver`) ; `cleTache`. Extrait de `JeuZonesService` arrivé au plafond de 400 lignes, à comportement constant ; une zone introuvable est rendue au service (`zonePerdue`) |
| `etat/jeu-zones.service.ts` | `JeuZonesService`, fourni par la PAGE (`FOURNISSEURS_JEU`, `carte.fournisseurs.ts`) : `zoneId`, `jeuId`, `jeu`, `cible`, `recette`, `extraction`, `plateformes`, `choix`, `couvertures`, `cercles`, `resumes`, `enCours`, `erreurs`, `erreur` ; `maj`, `relectureZone` ; `choisirZone(id, recette?, maj?)`, `zoneRecalculee(id)`, `adopter(detail)`, `regler(plateforme, {maille?, seuil?, rayon?})`, `valider(plateforme)`, `choisirExtraction(v)`. Un jeu s'ouvre par l'URL (`?jeu=`, `ouvrirJeuListe`) : `charger(jeuId)`, sans appelant, est retiré à la revue finale ; le registre se lit par un effet du service (privé) |

- **URL** : `?zoneJeu=<uuid>` (zone avant enregistrement) ou `?jeu=<uuid>` (jeu ouvert : il l'emporte, `?zoneJeu=`
  disparaît), `?mailles=` (les choix EXPLICITES : écarts aux défauts, ou au jeu ouvert), `?x=<version>` (avec un jeu
  seulement). Lus à la construction, réécrits en `replaceUrl` par `ecrireParametres` (P-g), relus à toute navigation
  extérieure ; une valeur illisible est réécrite une fois.
- **Aucune requête non demandée** : ouvrir ⑤ ne lit rien ; le registre se lit une fois par page, à l'arrivée d'une
  zone ou d'un jeu ; une conversion part par `valider` (ouverture de la colonne,
  relâchement de la réglette de rayon), jamais quatre d'un coup, et une seule couverture par (zone, cible, découpage).
  Régler un seuil ne requête RIEN (`resumes` rejoue la conversion pure en mémoire) ; un pavage en cercles dépend du
  rayon ET du seuil (calculé au serveur) : régler l'un ou l'autre le périme, sans requête, jusqu'au `valider` suivant.
- **Défauts (A-4)** : maille de `mailleParDefaut` (« à vérifier » écarté d'abord), seuil 20 %, rayon de la recette
  ramené dans les bornes de la ligne (sinon 10 km). Une maille exacte (A-6) est chiffrée sur la forme, sans seuil ;
  `exactitude` reçoit le rayon CHOISI. Zone sans recette lisible : seule la forme est exacte, comme à l'extraction.
- **Forme à jour (Review Focus 2)** : une zone recalculée en ③ garde son id. La date de mise à jour donnée par la
  liste (`choisirZone(id, recette, maj)`) entre dans la clé des couvertures. La liste n'étant lue qu'une fois par
  composant (le panneau reste monté), un recalcul fait dans « Mes zones » (`MesZonesComponent`) appelle
  `zoneRecalculee(id)` : `relectureZone` monte, `mg-choix-zone-analysee` (entrée `relire`) relit la liste, la NOUVELLE
  date vide les conversions, et l'effet du panneau (qui lit `maj`) les redemande — spec de page « ⑤ → ③ Mes zones →
  Recalculer → ⑤ » (revue finale, point 2). Un recalcul fait hors de la page n'est vu qu'au rechargement. Et une
  couverture lue sur une autre version de la forme (`zone_maj`) purge les couvertures et les pavages de la zone :
  jamais deux formes mêlées dans les bilans.
- **Refus** : 404 zone → `?zoneJeu=` retiré, « Zone introuvable dans cet espace. » ; 404 jeu → `?jeu=` retiré,
  « Jeu de zones introuvable dans cet espace. » ; jeu risque → `MESSAGE_JEU_RISQUE` (`ecran.ts`, verrouillé égal à
  `OU_SE_GERE.risque` du chargeur serveur) ; un autre `?jeu=` / `?zoneJeu=` arrivé par l'URL efface le message ;
  autre refus d'une conversion → `erreurs[plateforme]`, la zone reste.
- **Recette et date de la liste (T10)** : une zone arrivée par l'URL est lue SANS date ; quand la liste la date,
  `choisirZone(id, recette, maj)` ADOPTE la date (les couvertures lues passent sous la clé datée, `daterCouvertures`,
  et une lecture en vol n'est pas annulée : la clé d'une tâche ne porte pas la date, celle du rangement se calcule à
  l'arrivée). Une AUTRE date (zone recalculée en ③) vide tout. `GET /api/custom-geo/list` rend `updated_at`.
- **Cible et mode de plan (T10)** : `choisirCible` / `choisirMode` avant enregistrement, hors URL (R4 de T9) ; un jeu
  ouvert garde sa cible, son mode se change et part au PATCH. `choixDeBase` / `choixNeuf` (purs, `bilan.ts`).

## ⑤ Jeu de zones : l'écran (lot 5, T10, 2026-10-24)

| Fichier | Rôle |
|---|---|
| `panneaux/jeu/panneau-jeu.component.ts` | `mg-panneau-jeu`, monté par la page sous `@case ('jeu')` : Source (`mg-choix-zone-analysee` de ④ RÉUTILISÉ, champ « Zone » ; zone analysée PROPOSÉE, A-13 ; population et surface de la forme lues dans une conversion déjà là), cible (`mg-choix-cible`), mode de plan (`mg-mode-plan` du risque) ; bandeau `mg-kpi` (zone, plateformes chiffrées, meilleur taux d'utile, extraction) ; une colonne par plateforme ; phrase Q-J. Seul à appeler `valider`, pour les colonnes OUVERTES |
| `panneaux/jeu/colonne-plateforme.component.ts` | `mg-colonne-plateforme` : maille, badge neutre « À vérifier », date du relevé, « Doc officielle » (`doc_url`), rayon (cercle, borné par la ligne, réglé au relâchement), seuil (`mg-dilution` du risque, au relâchement), chiffres en JetBrains Mono (unités retenues / touchées, taux d'utile, habitants manqués et leur part, diffusion hors zone), « Exacte : aucune perte », avertissements de `verifierLimites`, cause d'un pavage vide (`motif_vide`) |
| `panneaux/jeu/choix-maille.component.ts` | `mg-choix-maille` : boutons segmentés des lignes du registre, natives d'abord ; `disponible = false` grisée, raison en infobulle et sous le bouton |
| `logique/jeu/ecran.ts` | PUR : noms des plateformes, unités par maille (`Record<Maille, …>`, jamais un ternaire cp/iris), phrases d'avertissement et de pavage vide, bornes de la réglette de rayon (registre, jamais un nombre écrit) |
| `testing/jeu-factice.ts` | Banc des écrans de ⑤ : état réel + routes réelles derrière `HttpTestingController` ; `monterJeu(BANC, composant, url, { lister?, entrees? })`, le montage commun des specs (les entrées `…/testing` d'Angular passées par le spec, `imports-partages.test.ts`) |

- **Colonnes** : côte à côte dès 900 px de PANNEAU (`ResizeObserver` sur l'hôte : la poignée du panneau d'étape décide,
  pas la fenêtre) ; plus étroit, empilées, une seule dépliée. Une zone choisie ne lit que la maille des colonnes
  ouvertes ; l'effet repasse quand le registre arrive et quand un choix change (aucune requête pour un seuil
  territorial, une au relâchement pour un cercle).
- **Pastille ⑤** : `?zoneJeu=` ou `?jeu=` (`suivreJeuRenseigne`, `carte.fournisseurs.ts`).
- **Réutilisé sans copie** : `mg-choix-zone-analysee` (entrées `libelle`, `proposee`, `revision`, sortie `lue` ajoutées, ④ inchangé ;
  `revision` = `OutilsCarteService.revisionZones()` : une zone créée en ③ après une première lecture de la liste y entre à la
  PROCHAINE ouverture, sans requête d'ici là — T14 : elle manquait à ⑤ jusqu'au rechargement),
  `mg-choix-cible`, `mg-mode-plan`, `mg-dilution` (entrées FACULTATIVES `titre`, `sujet`, `accord`, `complement`, `libelleCurseur` :
  défauts = le texte du module risque, son spec inchangé et vert), `mg-kpi`, `mg-entete-section`.

## ⑤ Jeu de zones : la carte (lot 5, T11, 2026-10-24)

| Fichier | Rôle |
|---|---|
| `couches/couche-unites.ts` | PUR : la peinture d'unités PAR PART (`--seq-1…5`), UN seul code pour ④ et ⑤ — `poserUnitesGeojson` (territoires, cercles), `poserUnitesIris` (tuiles `iris-source`, z ≥ 9, `niveau = 'iris'`), `expressionCouleurIris` (`match` groupé, six branches au plus), `classePart`, `libellesPaliers` (légende). `couche-couverture.ts` (④) y délègue ses aplats et garde contour et surbrillance |
| `couches/couche-jeu.ts` | PUR : la carte de ⑤ — contour de la zone exacte, unités retenues teintées, touchées non retenues en contour fin `--contour-carte` ; `entitesTerritoires` (rétention par `estRetenue`, la règle de l'extraction), `entitesCercles` (un pavage en UNE source) |
| `couches/jeu-carte.service.ts` | `JeuCarteService`, fourni par la PAGE (`FOURNISSEURS_JEU`) : `regarder(p)` (« Voir sur la carte » d'une colonne), `regardee`, `affichee`, `chargement`, `irisSousLeZoom` |

- **Lectures** : rien avant « Voir sur la carte ». Contour de la zone : `ZonesCustomApi.geometrie`, une lecture par zone,
  recadrage. CP et départements : `ContoursZonesService` (partagé, une lecture par échelle et par écran). Communes :
  `JeuxApi.contoursCommunes` de TOUTES les touchées, une lecture par jeu de codes ; le seuil tranche en mémoire (retenues
  teintées, autres en contour fin), aucune requête au relâchement ; au-delà de `MAX_CODES_CONTOURS` (le plafond de la
  route), les seules retenues, et la colonne le dit ; plus de `MAX_CODES_CONTOURS` RETENUES (`communesIllisibles`) :
  rien n'est lu (la route répondrait 400), et la colonne le dit aussi. « Extraire » attend l'enregistrement des réglages modifiés
  (`JeuZonesService.modifie`).
  Cercles : `cercleGeoJSON` du module risque. Maille exacte : le contour seul.
- **Une plateforme, une choroplèthe** : regarder une autre plateforme retire les couches de la précédente. Le geste
  porte sa zone : changer de zone l'annule. Peinte, la carte réclame le dégradé `'jeu'` (registre `logique/degrades.ts`
  ET sa source React `lib/carte/degrades.ts`, parité verrouillée ; `calques-actifs` et la légende React suivent) : la
  couverture de ④ se masque (« Afficher sur la carte » la rend, et masque alors ⑤). Légende des parts dans la colonne.
- **Cycle de vie** : re-posée sur une carte recréée (B11), repeinte au thème, masquée par « Tout effacer », retirée à la
  destruction du service.

## ⑤ Jeu de zones : enregistrer, bibliothèque, extraire (lot 5, T12, 2026-10-24)

| Fichier | Rôle |
|---|---|
| `panneaux/jeu/enregistrer-jeu.component.ts` | `mg-enregistrer-jeu` : nom (proposé : la zone), « Enregistrer le jeu » (POST) / « Enregistrer les réglages » (PATCH) ; le jeu est ADOPTÉ (`JeuZonesService.adopter`) sans relecture ; une requête par geste ; une réponse arrivée après un changement de zone ou de jeu n'est ni adoptée ni dite (P-c) |
| `panneaux/jeu/extractions-jeu.component.ts` | `mg-extractions-jeu` : « Extraire » (commentaire, recalage) puis la liste relue ; `deja_extraite`, réponse perdue (statut 0 : « vérifiez la liste des versions ») ; résumé figé par plateforme ; une version choisie → `?x=` ; le lot 6 (fichiers) annoncé par un texte ; une extraction en vol est désabonnée quand le jeu change |
| `panneaux/jeu/bibliotheque-jeux.component.ts` | `mg-bibliotheque-jeux` : jeux de l'espace (les deux types, badge neutre), lus à la première ouverture (`GET /api/zones/jeux?type=tous` — sans paramètre, la route ne rend que les jeux risque) ; relue quand un jeu adopté (enregistré, renommé) n'y figure pas ; ouvrir, supprimer (`mg-dialogue-suppression-zone`, `titre` / `texte`) |
| `etat/ouvrir-jeu.ts` | `ouvrirJeuListe` : un jeu risque → module (`risques`), un jeu de zone → ⑤ `?jeu=` ; partagé avec « Mes zones » (`jeux-de-zones.component.ts`, les deux types par `JeuxApi.lister`) |

## ⑥ Plan (lot 6, T1-T7, 2026-10-25)

V1 = contrôle des impressions et du budget dépensé (spec § 19). Deux services, fournis par la PAGE
(`FOURNISSEURS_PLAN`), jamais à la racine :

- **`etat/plan-campagne.service.ts`** (`PlanCampagneService`) — l'état de la campagne courante. Les écrans n'écrivent
  `?campagne=` que par lui (`choisirCampagne`, `lireUuid`). Préremplissage SÉQUENTIEL annulable : campagne →
  stratégie la plus récente (et sa cible, relue dans `in_zone_weights` : une campagne lancée rouverte retrouve son jeu
  et son extraction) → brouillon serveur (il PRIME) → canaux. Autosave débouncé (1 s). `catalogue` et `libelleCanal`
  (le catalogue résolu, une fois pour tous les écrans), `extraction` (résumé figé du choix), `previsions` et `totaux`
  (la SEULE source des chiffres : section Impressions, bandeau, pied, PATCH), `cpDe` / `chargerCp` (CP d'une
  extraction, mis en cache par clé). `jeterBrouillonsDe` est le SEUL chemin pour jeter un brouillon serveur
  (« Repartir de zéro », lancement réussi, campagne ouverte ou quittée) ; la remise est tenue PAR CAMPAGNE.
- **`etat/lancement-campagne.service.ts`** (`LancementCampagneService`) — la séquence du lancement, son état et ses
  notifications ; il survit à la destruction du pied (autre campagne, autre étape). Un lancement à la fois. La logique
  pure est dans `etat/lancement-campagne.ts` : `etatLancement` (validité, motifs en vouvoiement, demande),
  `lancerCampagne` (PATCH identité → `rattacher` → PATCH stratégie → PUT canaux avec `cpm_prevus`, le premier échec
  arrête tout ; un échec après `rattacher` porte la stratégie écrite), `messageEtape` (codes anglais des routes
  traduits), `messageLancement` (« N CP au plan, dont M retenus · … »).

**« N CP au plan, dont M retenus »** : les deux en codes BRUTS, comme `rattacher` les écrit (`total` et `retenus` de la route `…/cp`, un membre de groupe indiscernable par ligne) — la même unité que « Voir tout (n) ». `n_retenus` de l'extraction compte des codes canoniques : il n'est pas affiché à côté.

**Le prévu par CP et par plateforme** (« Voir par CP ») = impressions de la plateforme × multiplicateur ÷ Σ
multiplicateurs de SES CP. Ce n'est PAS `campaign_cp_rollup.planned_share` (agrégat campagne entière) : ⑧ le
recalculera par la même formule (contrat écrit dans `ARCHITECTURE.md`, spec § 19.4).

| Fichier | Rôle |
|---|---|
| `parcours/choix-campagne.component.ts` | `mg-choix-campagne`, dans la barre aux étapes `plan`, `activation`, `live` (`ETAPES_CAMPAGNE`) : liste lue au premier clic (relue si la campagne courante n'y est pas), « Nouvelle campagne » en tête (`creerCampagne`), nom de la campagne lue ; liste dans l'arbre, fermée à la sortie du focus ou sur Échap (aucun écouteur de document) |
| `panneaux/plan/panneau-plan.component.ts` | `mg-panneau-plan` : note « filtre de carte » (A-8, « le plan couvre toute la campagne ») ; sans campagne, le hall (et « introuvable dans cet espace ») ; avec, « ← Choisir une autre campagne », « Création / Modification — <nom> », bannière « Brouillon restauré », bandeau, trois `mg-entete-section` repliables (la plus basse dépliée = `current_step` du brouillon, A-2) et le pied ; sections grisées et inertes pendant le lancement de la campagne ouverte (V-9) ; un refus de rôle est dit, sans sections |
| `panneaux/plan/hall-campagnes.component.ts` | `mg-hall-campagnes`, port de `CreationHall` : campagnes → stratégies → brouillons en UNE chaîne séquentielle à chaque montage ; « Reprendre une création » et « Modifier une campagne lancée » (`partitionHall`) ; badge brouillon, suppression confirmée ; mode démo (A-7) |
| `panneaux/plan/section-cible.component.ts` | `mg-section-cible` (T4) : identité de `StepCible` (nom, annonceur, produit, par `modifier`), organisations de la campagne (lues une fois par campagne, après le préremplissage) ; panier et indicateur à seuil non portés (A-9) |
| `panneaux/plan/source-plan.component.ts` | `mg-source-plan` (T4), port étendu de `SourcePlan` (A-3) : jeux des deux types (badge Zone / Risque) lus après le préremplissage, versions d'un jeu au clic (jamais relues : une extraction est figée), jeu sans extraction grisé d'emblée (`n_extractions` de la liste) ; proposition dont la version n'existe plus dite ; choisir une version = `poserExtraction` (jeu + extraction, plateformes re-pré-cochées, budgets gardés, A-5) ; `?jeu=&x=` de ⑤ PROPOSÉ ; chiffres figés (« N CP au plan, dont M retenus », V-4), résumé par plateforme (« Toutes plateformes au code postal » pour un jeu risque, V-7), phrase du plan selon le type (classes pour un jeu risque, multiplicateurs de l'extraction pour un jeu de zone, V-3) |
| `panneaux/plan/section-plateformes.component.ts` | `mg-section-plateformes` (T5), port de `StepCanaux` sans ad server ni absorption : DSP et réseaux disponibles (connectés, ou démo), une ligne € par plateforme cochée, budget global = `totaux().budget` ; maille et taux d'utile de l'extraction en face de chaque plateforme (`resumeDuCanal`) ; plateformes de l'extraction non cochables dites ; accordéons de liaison ; récapitulatif et coche « Je confirme ces liaisons » (réinitialisée par `linksSelectionHash`) ; période |
| `panneaux/plan/liaison-canal.component.ts`, `liaison-dv360.component.ts`, `liaison-manuelle.component.ts`, `recap-canaux.component.ts` | la liaison d'une plateforme : cascade DV360 annonceur → campagne → insertion order (`GET /api/dsp/dv360/resources`) si DV360 est connecté, saisie manuelle sinon, récapitulatif du câblage |
| `panneaux/plan/section-impressions.component.ts` | `mg-section-impressions` (T5) : CPM prévu par plateforme, impressions prévues (budget ÷ CPM × 1 000), maille de l'extraction ou « Hors de l'extraction » (accepté, V-6) ; « Voir par CP » au clic pour une plateforme au CP (jeu risque : toutes, sur le plan CP entier), 50 lignes puis « Voir tout » ; total et CPM manquants. Le même fichier porte `mg-bandeau-plan` (budget, impressions, CPM moyen, plateformes, « CP au plan » avec « dont M retenus ») |
| `panneaux/plan/pied-lancement.component.ts` | `mg-pied-lancement` (T6) : récapitulatif, motifs de blocage (et « Un lancement est en cours sur une autre campagne. »), bouton « Créer la campagne → » (« Mettre à jour le plan → » en Modification, V-5), issue (« ✓ Campagne créée » / « ✓ Plan mis à jour », message, « Préparer l'activation → ⑦ », « Modifier et relancer »), échec nommé par étape ; affiche et déclenche, l'orchestration est au service |
| `panneaux/plan/styles-plan.ts` | classes partagées : `SAISIE*`, `CTA` (pied et hall), `TEXTE_SUCCES`, `CADRE_LIAISON` |
| `logique/plan/brouillon.ts` | `ProgDraft` et la logique copiée de React (`draftTotalBudget`, `linksSelectionHash`, `serializeDraft`…, `fmtEUR`, `fmtDateShort`) ; `fmtCpm` (Angular seul) |
| `logique/plan/canaux.ts`, `liens-plateformes.ts` | copies de `lib/campaigns/{channels,platform-links}.ts` |
| `logique/plan/impressions.ts` | `impressionsPrevues` (= `computeForecast`), `previsions`, `totauxPrevus` (CPM moyen pondéré), `repartitionParCp` (plus forts restes : la somme retombe sur le total) |
| `logique/plan/plateformes-canaux.ts` | `CANAL_DE_PLATEFORME`, `preselectionDepuisExtraction`, `poserExtraction` (T4), `utilePlateforme` et `resumeDuCanal` (le résumé d'un canal coché dans l'extraction ; jeu risque = toutes plateformes au CP, V-7) |
| `logique/plan/preremplissage.ts` | `remplirIdentite`, `remplirDepuisStrategie` (CPM, dates, mode, et la cible via `cibleDeStrategie`), `remplirCanaux` |
| `logique/plan/saisie.ts` | `basculerPlateforme`, `lireMontant`, `poserMontant` |
| `logique/plan/partition.ts` | `partitionHall`, copie de `partitionCampaigns` réduite au hall |
| `etat/cps-extractions.ts` | `CpsExtractions`, le cache des CP lus des extractions (une lecture par jeu, version, plateforme), composé par `PlanCampagneService` |
| `etat/erreurs-campagnes.ts` | `MESSAGE_RESERVE_ADMIN`, `classer`, `messageErreurCampagnes` : les échecs sur les campagnes (service, hall, sélecteur, Cible) ; `verifierEspace` : une campagne d'un autre espace (lue par un super_admin, route non bornée) est introuvable, paramètre retiré, ni brouillon ni lancement |
| `testing/plan-factice.ts` | la doublure de `PlanCampagneService` des specs d'écran (`catalogue`, `previsions`, `totaux` : les vrais calculs) |

**Dupliqué à dessein** (verrouillé par `tests/unit/angular/plan-logique-paritaire.test.ts`, à retirer côté React à la
bascule) : `brouillon.ts`, `canaux.ts`, `liens-plateformes.ts`, `impressionsPrevues`, `partition.ts`. Sans parité
automatique, faute de fonction React à importer : `preremplissage.ts`, `etatLancement`, `messageLancement` (leurs specs
Angular les couvrent ; écarts listés en tête de fichier).

`messageErreurCampagnes` (service) : un 401/403 sur les campagnes se dit « La gestion des campagnes est réservée aux
administrateurs. » (V1 : super_admin seul) — hall, sélecteur et panneau le disent, jamais en silence.

## ⑦ Activation (lot 7, T1-T6, 2026-10-26)

Plan `docs/superpowers/plans/2026-10-25-carte-en-parcours-lot-7-activation.md`. V1 = **envoyer les zones**, rien
d'autre : poussée API DV360 seule (ciblage géographique), fichiers pour The Trade Desk, Meta et TikTok ; aucun custom
bidding, pacing, ad server, ni le mot « stratégie » à l'écran (E4). Port quasi tel quel d'`ActivationPanel.tsx`
(onglet Activation de l'overlay React), découpé en UNE carte par plateforme cochée en ⑥ (A-4).

- **Rien n'est lu avant l'espace validé** : `ActivationCampagneService.validee` attend que `PlanCampagneService` ait
  fini son préremplissage pour CETTE campagne (`prerempli && detail.id === campagne`, accès non refusé) — les routes
  admin ne filtrent pas l'espace pour le super_admin. Le serveur refait le contrôle (prevol et pousser, 404 avant
  toute écriture).
- **À la demande** (revue finale, M-3) : hors de ⑦, l'historique seul (la pastille) ; pré-vol → historique →
  registre → versions du jeu en UN abonnement séquentiel annulable, à la première entrée dans ⑦ pour la campagne.
- **Mode de la poussée** (`prevol.mode_dv360`, calculé côté serveur, jamais lu du corps) : `reel` avec une connexion
  DV360 `connected` (liste blanche, `connexionUtilisable`) ; sinon **simulé** sur une campagne de démo — mêmes
  contrôles et mêmes comptes que le réel, rien ne part chez Google, lot marqué `mode = 'simule'` (sql/281), carte
  « Simulé », bouton « Simuler la poussée vers DV360 » ; sinon `indisponible` (fichier SDF en repli).
- **La poussée appartient à SA campagne** (A-10) : changer de campagne ou d'étape ne l'interrompt pas ; sur une autre
  campagne, Pousser est désactivé (« Une poussée est en cours sur une autre campagne. »). Le panneau reste MONTÉ hors
  de l'étape. Un changement d'espace recrée la page : la requête est abandonnée, le serveur clôt le lot.
- **Les comptes** : la nature d'une carte dit les unités RETENUES de l'extraction (« 63 CP — conversion de la zone
  (95,0 % d'utile) », taux de `resumeDuCanal`, le même qu'en ⑥) ; la poussée et le pré-vol disent les CP bruts que
  DV360 reçoit (`n_cp_dv360`, « 79 codes postaux bruts »), jamais `n_codes_postaux` (toutes plateformes, gardé pour
  React, I-2).
- **Les fichiers** : `mg-fichiers-extraction` (aussi sous chaque version en ⑤, A-14), par `mg-bouton-export` ; formats
  par (plateforme, maille) recopiés du serveur (`formatsDe`, verrou `tests/unit/angular/activation-paritaire.test.ts`).

| Fichier | Rôle |
|---|---|
| `data/activation.api.ts` | `ActivationApi` (`FOURNISSEURS_DISTANTS`) : `prevol`, `historique`, `pousser` (NDJSON par `lignesNdjson`), `annuler`, `publier`, `fichier` ; types `Prevol`, `MotifPrevol`, `LotActivation`, `LigneFlux` |
| `etat/activation-campagne.service.ts` | `ActivationCampagneService` (page, `FOURNISSEURS_ACTIVATION`) : lecture, cartes, bandeau, pastille (`renseignee`), poussée, publication, annulation (`MESSAGE_ANNULATION`, texte clair au lieu de celui de la route, effacé au début d'une poussée, d'une publication ou d'un changement de campagne — preuve C-3, C-5) ; `messageGeste`, le SEUL lecteur du corps d'un refus (motif par `texteMotif`, puis `message ?? error`, F-5) |
| `logique/activation/cartes.ts` | `cartesActivation` (PUR) : ordre du registre, nature, mode, motifs, avertissements réglementaires (A-13) ; `formatsDe` (copie verrouillée) |
| `logique/activation/bandeau.ts` | `bandeauActivation`, `lotAbouti`, `estPrete` (PURS) ; dates par `dateHeureFr` (`core/format/date`) |
| `logique/activation/motifs.ts` | `texteMotif` (réécrit les deux motifs qui disent « stratégie »), `motifDePublication`, `libellePublication` |
| `logique/activation/line-items.ts` | parsing des line items de React rejoué ; `MAX_LINE_ITEMS` = `MAX_CIBLES` du serveur (verrou paritaire, F-6) |
| `logique/activation/fichiers.ts` | libellés des formats, nom de repli d'un fichier |
| `logique/activation/statuts.ts` | LA table des libellés de statut de lot et de cible (`libelleStatut`, `statutMinuscule`, `compteStatut`, `compteLineItems` accordés) : historique, détail d'un lot, flux — React affichait les codes bruts (preuve C-2) |
| `panneaux/activation/panneau-activation.component.ts` | `mg-panneau-activation` : renvois vers ⑥, pré-vol, cartes, flux, historique |
| `panneaux/activation/carte-plateforme.component.ts` | `mg-carte-plateforme` : en-tête, mode, nature, motifs, avertissements ; contenu projeté |
| `panneaux/activation/poussee-dv360.component.ts` | `mg-poussee-dv360` : publication, annonceur prérempli (liaison de ⑥), line items, bouton |
| `panneaux/activation/fichiers-extraction.component.ts` | `mg-fichiers-extraction` : un bouton par format, « à vérifier » |
| `panneaux/activation/flux-poussee.component.ts`, `historique-activation.component.ts`, `bandeau-activation.component.ts` | le flux de la poussée, l'historique (annulation par `mg-confirmation`), le bandeau de l'étape (A-12) |
| `panneaux/activation/styles-activation.ts` | classes de ⑦ aux mesures de React : `CADRE`, `ENCART_MOTIF`, `ENCART_PRET`, `SAISIE_MONO`, `BOUTON_POUSSEE`, `BOUTON_NEUTRE`, `POINT_STATUT` |
| `testing/activation-factice.ts` | la doublure de `ActivationCampagneService` des specs d'écran |

**Dupliqué à dessein** : `formatsDe` / `FORMATS_FICHIER` et `MAX_LINE_ITEMS` (verrou
`activation-paritaire.test.ts`) ; le parsing des line items (React l'écrit dans le composant, il ne s'importe pas :
verrouillé par REJEU des cas de React dans `line-items.spec.ts`) ; `CodeMotif` / `ModeDv360` (Angular n'importe pas
le serveur ; `texteMotif` retombe sur le message serveur pour un code inconnu).

## Le périmètre national (retours du 26/10, T3-T4)

- **« France Metro » et « France + DROM » sont des FILTRES** (`logique/perimetre-national.ts`, propre à Angular, qui
  enveloppe les copies VERBATIM sans les toucher) : `FILTRE_METROPOLE` (`{ type: 'france', code: 'metro' }`) et
  `FILTRE_FRANCE_ENTIERE` (`code: 'france'`, la valeur d'avant). `perimetreScope` suit le filtre à chaque écriture de
  ① et la pastille allumée en est dérivée (`scopeDuFiltre`) : les deux ne se contredisent pas. Le bloc « Périmètre
  national » (bouton « France entière ») est retiré (Vincent, Q-2) ; une pastille remplace un filtre `zone`.
- **Les POI suivent le filtre** : `afficher()` envoie région, département, commune ou code postal
  (`corpsPoisDuFiltre`), et la portée `metro` / `all` du filtre. Avec un territoire, `PoisService.chercher` n'ajoute
  plus la bbox de repli `BBOX_METRO` (elle vidait une région d'outre-mer).
- **④ et ③ sur la métropole (T4)** : la garde est `messageGardeCarte` (la Bataille V2 et le score passent, le
  clustering refuse en nommant la métropole ; le Voronoï est supprimé depuis le 30/10). Une bataille sans territoire compte ses POI AU CLIC
  (`ContexteBatailleService.verifierBorne` : une vérification du cache, premier palier seul ; le journal dit
  « > Vérification de la capacité en direct… » pendant ce comptage, T8) et applique la copie de
  `lib/isochrones/borne-nationale.ts` (`logique/bataille/borne-nationale.ts`, parité verrouillée) : au-delà de 700
  anneaux ou de 500 POI lus, le message « tâche de fond » au journal et en tête du panneau, rien ne part. Le
  comptage est fait sur le contexte figé ; une réponse arrivée après un changement de filtre ne lance ni ne refuse
  rien. L'écran se règle sur `points × paliers` (plus strict que la V2 serveur, qui compte les anneaux en cache). Avec
  un territoire, aucun comptage : la V2 serveur refait la capacité.
  ③ : « Autour des POI » part en `METRO` ; les deux seuils disent `seuil_metropole_differe`.
- **Écarts à React (A-1, non corrigé, gel P5)** : la pastille n'y est qu'un `perimeterScope` ; le corps des POI part
  avec régions, départements et ville vides ; le bloc « France entière » y reste ; la bataille et « Autour des POI »
  y restent refusés sur la métropole.

## La bataille V1 retirée (décision de Vincent, 27/10)

- **Partis d'Angular** : l'outil « Isochrones routiers (ORS) » (`mg-outil-isochrones`), `BatailleV1Service`, son
  application `ST_Difference` (`IsochronesApi.appliquer`, `POST /api/isochrone-battle/apply-battle`), le journal V1
  (ticker, progression, teintes : `journalInitialV1`, `tickJournal`, `remplacerProgression`, `compteursProgression`,
  `teinteLigneV1`), `parametresV1`, `libelleTerritoire`, `pctApplication`, `anneauxPourDecoupe`, la variante `v1` de
  `mg-journal-bataille` et `mg-statut-cache`, la capacité locale de `ContexteBatailleService` (`capaciteLocale`), et
  `bataille_v1` / `application_bataille` des outils admis sur la métropole (`perimetre-national.ts`).
- **Reste** : la Bataille V2 et son **remplissage ORS** du cache (« CALCULER N POIS MANQUANTS (ORS) »). Ce remplissage
  passe par `POST /api/isochrone-battle`, la route PROTÉGÉE de l'ancienne V1 (`IsochronesApi.remplirCache`, corps
  `corpsRemplissage`, identique à celui de React). **La route a donc encore UN appelant Angular**, le remplissage, et
  aucun pour la V1 elle-même. Elle n'est pas touchée (fichier protégé) ; elle partira, avec
  `/api/isochrone-battle/apply-battle` (qui n'a plus d'appelant Angular), au retrait de React, à condition que le
  remplissage de la V2 ait alors sa propre route.
- **Gardés tels quels, parce que ce sont des copies VERBATIM que React emploie** : `logique/garde-perimetre.ts` (les outils
  `bataille_v1` et `application_bataille` y restent) et `logique/modes-isochrones.ts` (`DirectBattleParams`).
  `borne-nationale.ts` aussi (`refusCapaciteAnneaux` sert la route V2).
- **Texte changé** : la V2 disait « Lance d'abord les isochrones v1 pour remplir le cache. ». Elle dit maintenant
  « S’il en manque, vérifiez le cache puis calculez les POI manquants (ORS) avec le bouton qui apparaît. ». L'encart
  d'accueil annonçait « Isochrones routiers — Temps de trajet réel ORS ». Il annonce maintenant « Bataille V2
  (multi-paliers) — Temps de trajet ORS, lus dans le cache ».
- **Écart à React** : React garde sa V1 (gel P5).

## Les tiroirs exclusifs (retours du 26/10, T7 ; revue finale T8)

- **Une brique** : `etat/tiroirs-exclusifs.ts` (`TiroirsExclusifs<K>`, sans DI, instanciée par panneau) — `ouvert`,
  `estOuvert`, `basculer`, `ouvrir`, `fermer`, `dejaOuvert` (vrai dès le premier dépli : patron « monté puis caché »,
  A-12). ④ la partage entre ses outils et ses services par le jeton `TIROIRS_ANALYSE` (`etat/tiroirs-analyse.ts`) :
  `CouvertureRayonService.ouvert` et `ScoreCompositeService.ouvert` en DÉRIVENT (`computed`). Sans fournisseur (outil
  monté seul en spec), `injecterTiroirsAnalyse` rend un jeu propre à l'appelant : l'exclusivité tombe alors sans
  avertissement (m-2 de la relecture T7, non traité : un avertissement sonnerait dans chaque spec isolée).
- **Par panneau** : ① cinq tiroirs (initial « Périmètre global »), ② un référentiel déplié à la fois, ③ une famille
  (initial « Autour des POI »), ④ couverture · rayon · score · corrélation · clustering (« Analyse spatiale » est un
  en-tête de groupe, hors du jeu, A-11), ⑥ cible · plateformes · impressions (initial « Cible »). ⑤ l'était déjà.
- **Rouvrir ne relit rien** (vérifié à l'onglet réseau le 27/10, :4202) : ③ cache ses formulaires (le catalogue
  d'indicateurs n'est lu qu'au premier dépli de « Par seuil ») ; le rayon et le dessin restent MONTÉS et passent EN
  PAUSE (`enPause` : pose arrêtée et aperçu retiré, `DessinService.suspendre` / `reprendre`, tracé gardé ; une
  création en vol aboutit et relit « Mes zones ») ; rouvrir une famille rend actif son dernier formulaire touché ; la
  couverture de ④ est cachée ; la fiche santé de ② garde son cache dans `CacheFichesSante` ; le clustering ne lit sa
  liste qu'au premier dépli (ou après un échec).
- **Écarts à React, arbitrés par Vincent le 27/10 (tous acceptés)** : (1) ④ s'ouvre sur la couverture, pas sur « aucun »
  (A-11 disait « aucun » ; la couverture était l'outil de tête depuis le lot 4) — accepté avec une barre de progression
  pendant le chiffrage : barre d'attente (un seul appel, aucun avancement intermédiaire, donc pas de pourcentage),
  étape nommée et secondes écoulées, deux étapes par code postal (calcul, puis contours CP) ; (2) ① n'ouvre plus que « Périmètre
  global » : enchaîner région puis département demande d'ouvrir le tiroir Départements, qui referme Régions ; (3) ⑥
  n'ouvre plus que « Cible » ; (4) le clustering ne relit plus sa liste à chaque ouverture : un modèle calculé dans un
  autre onglet n'apparaît qu'au rechargement ; (5) le cache de la fiche santé survit au repli de sa ligne.
- **② « POI communs »** : ouvert de force (une case cochée, une recherche), le bouton porte `aria-disabled` et son
  clic ne bascule plus l'état manuel en douce (m-3 de T6, T8). Le prédicat « clé de type de POI » n'a plus qu'une
  écriture, `estClePoi` (`rangement-jeux.ts`).

## Cycle de vie d'une couche

1. **Allumée** par sa section de `panneaux/calques/`, dépliée dans sa ligne de ② (ou un outil) : le service passe `visible` à vrai.
2. **Posée** par un `effect` du service sur `CouchesCarteService.carteCourante()` : `quandStyleCharge`, puis
   `addSource` / `addLayer` IDEMPOTENTS (on teste `getSource` / `getLayer` sur l'instance courante, jamais un
   drapeau gardé), à sa place d'empilement (`avantDe`, ordre de `logique/ordre-couches.ts`).
3. **Lue** sur la bbox VISIBLE, au `moveend` après un temps de calme, la requête précédente annulée ; jamais
   la France entière d'un coup.
4. **Repeinte** quand le thème change : couleurs CALCULÉES par `CouleursService.palette(JETONS)` dans un
   `effect`, `setPaintProperty` — jamais `var()` dans `paint`.
5. **Re-posée** après un changement de fond : la page recrée l'instance, `carteCourante` passe par `null`
   puis la nouvelle carte, et l'étape 2 rejoue d'elle-même.
6. **Effacée** par « Tout effacer » : le service s'inscrit par `inscrireEffacement('<id>', …)`.

Un seul dégradé de couleur à la fois (carreaux, IRIS, civique, santé, météo, zones, score…) :
`EtatCarteService.basculerDegrade` évince le précédent et l'annonce dans le geste.

## Où ajouter…

- **une couche** : `couches/<nom>.service.ts` + `couches/couche-<nom>.ts`, le service dans les `providers` de
  `carte.page.ts`, ses identifiants dans `logique/ordre-couches.ts` (`carte-ordre-couches.test.ts`), sa
  section dans `panneaux/calques/`, son bloc éventuel dans `logique/legende.ts` + `legende/`.
- **un outil de la boîte à outils** : une entrée dans `OUTILS` (`outils/boite-outils.component.ts`), son id dans
  `OutilCarte`, son contenu dans le `@switch` du tiroir. Une bascule sans tiroir (comme la Légende) est un signal
  d'`OutilsCarteService`.
- **un outil d'analyse** : un composant dans `panneaux/analyse/`, son lancement gardé par
  `verifierPerimetreOutil('<outil>')` et déclaré dans `panneau-analyse-garde.test.ts`.
- **une étape du parcours** : `logique/parcours.ts` (`ETAPES_CARTE`, libellés, consignes) est la seule définition —
  le fil, l'URL, le clavier et l'aide la lisent ; son panneau se branche dans le `@switch` de `carte.page.html`.
  Il n'y a plus de rail (2026-10-13) : la copie de `lib/navigation/config.ts` est supprimée, React garde la sienne.
