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
| `panneaux/` | le contenu de chaque étape : `filtre/`, `calques/` (une section par couche), `analyse/` (bataille d'isochrones, corrélation, score, clustering), `zones/` (création ; « Mes zones » et les jeux de zones, montés par l'outil Mes zones ; plan média), `autres/` (le panneau « Autres » : panneaux OOH et radio, hors du fil), `donnees/` (② : la ligne uniforme d'un jeu, `mg-ligne-jeu`, T12) ; `aide` et `reglages`, contenus des tiroirs de la boîte à outils |
| `couches/` | une couche = un service (`*.service.ts` : état, lectures, pose) + ses fonctions pures (`couche-*.ts` : sources, couches, peintures, popups) |
| `etat/` | état de l'écran : `parcours.service.ts` (étape courante, étapes visitées, `?etape=`), `etat-carte.service.ts` (mode immersif, filtre, dégradé actif…), `couches-carte.service.ts` (registre des couches, `carteCourante`), pile Échap, annonces, zones, bataille, score…, `jeux-recommandes.service.ts` (la sélection recommandée de l'espace, lue une fois par ②) |
| `data/` | services d'API de la carte (`*.api.ts`) |
| `logique/` | fonctions pures : `parcours.ts` (les huit étapes, l'URL, les raccourcis), `jeux-carte.ts` (le registre des jeux) et `rangement-jeux.ts` (le rangement de ② : espace, recommandés, « Plus de données communes »), copies de la logique React (`palettes-donnees-carte.ts`, `carreaux/`, `meteo/`…, verrouillées par les tests `carte-*-paritaire`), ordre des couches, gardes, règles de la légende |
| `legende/` | la légende unique (`legende-carte`) et ses blocs propres (score, bataille, zones du profil) |
| `commun/` | annonce, choix du fond (`mg-choix-fond`, tiroir « Fond de carte ») |

## La navigation : le parcours (lot 1, 2026-10-13)

- **Où j'en suis** : `mg-fil-etapes` dans `mg-barre-parcours`, ou `Alt+1…Alt+8` (lus sur `KeyboardEvent.code`, pavé numérique
  compris, donc valables en AZERTY ; inertes sous le module risque et dans un champ de saisie). L'étape s'écrit dans `?etape=` par
  `ParcoursService` (`replaceUrl`, `merge`) ; ① n'est pas écrite. Pas un tunnel : chaque étape reste ouverte.
  `?etape=` porte un IDENTIFIANT (`perimetre`, `donnees`, `zones`, `analyse`, `jeu`, `plan`, `activation`, `live`),
  jamais un numéro : les liens d'avant le passage à 8 étapes restent valides, et il n'y a pas d'alias numérique.
  Le fil est COMPACT (`[compact]="true"`, conteneur `@container`) : une ligne par étape, et sous 630 px de conteneur (« Autres » compris ; `nav` compact sans écart, T11b)
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
- **Aucune fonction perdue** : le describe « aucune fonction perdue (spec § 12, lot 1) » de `carte.page.spec.ts`
  (`INVENTAIRE`) dit où vit chaque fonction de l'ancienne carte. Une ligne rouge = une fonction perdue : la rétablir.

## Cycle de vie d'une couche

1. **Allumée** par sa section de `panneaux/calques/` (ou un outil) : le service passe `visible` à vrai.
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
