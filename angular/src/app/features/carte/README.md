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
| `parcours/` | la barre du parcours (`mg-barre-parcours` : fil d'Ariane, fil d'étapes, bouton « Autres » hors du fil, actions), le panneau d'étape (`mg-panneau-etape` : poignée, repli « carte seule »), les étapes « bientôt » ⑤-⑧ |
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
  construit pas de zones) ; leurs couches restent dans `OohService`/`RadioService` (page), leurs sections et régies dans
  le `SelectionsCalquesService` du panneau Autres, monté à la première ouverture puis gardé.
- **Où je regarde** : le fil d'Ariane de la barre, nourri par le filtre de ① ; « France entière » le retire.
- **Le panneau d'étape** (`mg-panneau-etape`) est une carte flottante `absolute` dans `[data-zone-carte]` : la carte
  garde toute sa largeur, `couches/marge-carte.ts` lui pose un `setPadding` pour que centrage et recadrages visent la
  partie que le panneau laisse libre. Poignée 320-900 px, repli « carte seule », largeur et repli jamais dans l'URL.
  Chaque panneau est monté à la PREMIÈRE visite de son étape puis gardé (`invisible` + `inert`) : revenir ne relit rien.
- **La boîte à outils** (`mg-boite-outils`) : Mes analyses, Mes zones, Fond de carte, Légende (bascule), Aide (celle de
  l'étape courante + raccourcis), Réglages (apparence, back office). Un tiroir à la fois, Échap le ferme.
- **Dans la barre** : « Script bidding DV360 » (lien `?customZone=`) et « Plan média (n) » quand ils ont un objet,
  « Tout effacer », mode immersif (sortie : bouton de la boîte à outils ou Échap), thème, session et espace.
- ⑤ Jeu de zones (le convertisseur zones → codes postaux achetables, lot 5) affiche « Bientôt dans le parcours. »,
  sans lien : React n'a rien d'équivalent hors du module risque. ⑥-⑧ aussi, avec un lien vers l'écran React si
  `urlApplicationReact` est posé. Les outils de ③ et ④ n'ont pas bougé : rayons et isochrones comme types de zone de
  ③, couverture par territoire dans ④, c'est aux lots 4-5.
- **La pastille « renseignée »** d'une étape (`etatsEtapes`, `logique/parcours.ts`, table `RENSEIGNEE_PAR`) : ① un
  filtre posé, ② un jeu de ② affiché (`DonneesAfficheesService`, la même source que les pastilles des lignes ; ni OOH
  ni radio), ④ le score composite OU les zones à risque sur la carte (T14). Les autres étapes ne s'allument pas encore.
- **Aucune fonction perdue** : le describe « aucune fonction perdue (spec § 12, lot 1) » de `carte.page.spec.ts`
  (`INVENTAIRE`) dit où vit chaque fonction de l'ancienne carte. Une ligne rouge = une fonction perdue : la rétablir.

## ② Données : les jeux rangés (lot 2, 2026-10-14)

- **Le panneau** `mg-panneau-donnees` remplace l'ancien « Calques » : « Actifs (n) », les actions POI, « Chercher un
  jeu », « Données de l'espace » (ses types de POI, ou « Cet espace n'a importé aucune donnée. »), « Données
  communes » (la sélection recommandée de l'espace) et, replié, « Plus de données communes (n) ». Sans sélection — ou
  une sélection qui ne désigne aucun jeu présent — tout est déplié et le repli n'existe pas.
- **Les jeux** : `logique/jeux-carte.ts` (registre, copie de `lib/carte/jeux-carte.ts`) — 8 référentiels communs (IRIS,
  carreaux, indicateurs CP, transport, TMJA, ICPE et PPRT, santé, météo) plus les types de POI ; OOH et radio vivent
  dans `JEUX_AUTRES`, jamais dans ②. `logique/rangement-jeux.ts` les range ; la recherche filtre APRÈS le rangement.
- **La ligne** `mg-ligne-jeu` : nom, nature · maille, pastille « affiché », puis une case (type de POI — « Afficher
  les POI » reste un geste) ou un chevron qui déplie la section `integre` (en-tête masqué, contenu ouvert), instanciée
  seulement dépliée.
- **Ce que la première visite lit** : `GET /api/map/categories` et `GET /api/map/jeux-recommandes`, rien d'autre —
  aucun calque ni tuile avant un geste. La sélection se règle dans Accès › fiche espace › Données
  (`mg-jeux-recommandes`) ; une recommandation range, elle ne donne ni ne retire aucun droit.

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
  et un 207 est une réussite (la zone existe : atelier vidé, jamais renvoyée). Piste de chargement `atelier-zone` :
  la page fournit `ChargementService` et monte `mg-barre-progression` sous la barre du parcours.
- **La couche** : `couches/apercu-zone.ts` (`apercu-zone-fill` / `apercu-zone-line`, au-dessus de l'aperçu du rayon
  dans `logique/ordre-couches.ts`), teal 0,15 et contour pointillé `[2, 2]` ; pose et retrait communs avec l'aperçu du
  rayon dans `couches/apercu-forme.ts`.

## ③ Zones par familles (lot 3, T10, 2026-10-15)

- **Le panneau** `panneaux/zones/panneau-zones.component.ts` : la ligne du périmètre de ① en tête, puis quatre familles
  `mg-entete-section` repliables, dans l'ordre « Autour des POI » (ouverte : rayon autour d'un point, rayon autour d'un
  type de POI) · « Par seuil » (carreaux 200 m ; IRIS ou codes postaux) · « À la main » (dessin, import GeoJSON / KML,
  liste de codes postaux) · « Capture » (le bouton existant, libellé inchangé), puis `mg-pied-recette` et le renvoi
  vers « Mes zones ». Fournit `CreationZoneService`, `AtelierZoneService` et `CatalogueIndicateursService`. Une famille
  repliée démonte ses formulaires (aucun calcul n'y vit) ; replier « À la main » pendant un tracé rend la carte.
- **Les quatre formulaires** (`recette-rayon-poi`, `recette-seuil-carreaux`, `recette-seuil-territoire`,
  `recette-import`) ne font que COMPOSER : un signal `recette` (`null` tant que leur garde refuse — aucun périmètre,
  France, région pour les carreaux, catalogue indisponible, fichier refusé) et leur texte de garde `[data-garde]`.
  Styles communs : `styles-recette.ts`. Aucune lecture à l'ouverture de ③ : les types de POI viennent du catalogue de
  la page (`chargerUneFois`), le catalogue d'indicateurs n'est lu qu'à l'ouverture de « Par seuil ». L'import refuse un
  fichier de plus de 5 Mo AVANT de le lire (`TAILLE_MAX_IMPORT_OCTETS` : un parse de 100 Mo fige l'onglet).
- **Le pied** `mg-pied-recette` (arbitrage P4), monté une fois : reçoit la recette du formulaire ACTIF (le dernier
  touché, ou le premier d'une famille qu'on ouvre ; liseré teal), porte « Aperçu », les chiffres de l'aperçu
  (`formaterNombre` : surface, carreaux / POI / territoires, habitants ; part dans le périmètre sous 98 %), le nom (le
  libellé de la recette par défaut) et « Enregistrer la zone ». Enregistrer est inactif dès le premier clic et tant que
  l'aperçu n'est plus celui du formulaire actif (réglages changés, formulaire disparu, autre fichier) ; « Effacer » l'est pendant un calcul ; un 207 n'est jamais renvoyé — si la
  recette se recalcule, « Mes zones » est proposé.
- **Les créateurs du lot 4 et les opérations écrivent une recette** : `CreationZoneService.creer(source, nom, recette)`
  écrit par `POST /api/zones` (codes postaux → `codes_postaux` avec les codes retenus par la route source ; rayon →
  `rayon_point` ; dessin → `dessin` avec sa géométrie réparée ; « Créer la zone » du score composite → `capture` de
  source `score` avec sa géométrie — la géométrie part pour toute recette non recalculable). Les opérations de « Mes
  zones » écrivent `combinaison` en UN appel (« Restreindre à » actif à deux zones exactement). Une zone citée (`zone_referencee`) ne se supprime pas (409).
  `CreationZoneService.org` reste lu par la capture.
- **La capture garde sa recette ; isochrones et bataille restent en ④ (T11, arbitrage C3 / L3-5)** : rien n'est retiré
  de ④. `mg-capture` ajoute au corps de `POST /api/custom-geo/capture` une recette FIGÉE (`recetteCapture`) —
  `isochrone` quand une couche capturée est une bataille, ses `parametres` étant les clés scalaires de son
  enrichissement (`cache_key`, `category`, `mode`, `poi_count` : la métadonnée de la couche ne porte ni `minutes` ni
  `version` ; POI et paliers restent dans `source_metadata` et les sous-zones), sinon `capture` avec le
  `source_type`. « Autour des POI » porte le renvoi `[data-renvoi-analyse]` et « Aller à ④ Analyse »
  (`ParcoursService.choisir('analyse')`) ; ③ ne monte ni `mg-outil-isochrones` ni `mg-outil-bataille-v2`.

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
