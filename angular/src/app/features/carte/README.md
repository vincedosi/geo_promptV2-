# carte — la carte principale

**Rôle** : portage de `/map` (lot 4) — la carte plein écran, son rail d'outils (Filtre, Calques, Analyse, Zones,
Réglages, Aide), sa barre du haut et ses couches. Le module risque s'y ouvre en surimpression.

**Route** : `carte` (`/app/carte`), plein écran, sœur de la coquille, `authGuard`. Son outlet enfant porte
`risques` (voir `features/risques/README.md`) : ouvrir puis fermer le module ne recrée jamais la carte.

**Entrée** : `carte.page.ts` (+ `.html`, sélecteur `mg-carte-principale`) — elle FOURNIT tous les services
d'état et de couche (`providers`) : ils naissent et meurent avec l'écran.

## Les sous-dossiers

| Dossier | Contenu |
|---|---|
| `rail/` | rail d'outils, barre du haut, cadre du panneau (`mg-panneau-carte`, 340 px, empilé dans la pile Échap) |
| `panneaux/` | le contenu de chaque outil du rail : `filtre/`, `calques/` (une section par couche), `analyse/` (bataille d'isochrones, corrélation, score, clustering), `zones/` (création, mes zones, jeux, plan média), `aide`, `reglages` |
| `couches/` | une couche = un service (`*.service.ts` : état, lectures, pose) + ses fonctions pures (`couche-*.ts` : sources, couches, peintures, popups) |
| `etat/` | état de l'écran : `etat-carte.service.ts` (entrée active, filtre, dégradé actif…), `couches-carte.service.ts` (registre des couches, `carteCourante`), pile Échap, annonces, zones, bataille, score… |
| `data/` | services d'API de la carte (`*.api.ts`) |
| `logique/` | fonctions pures : copies de la logique React (`navigation.ts`, `palettes-donnees-carte.ts`, `carreaux/`, `meteo/`…, verrouillées par les tests `carte-*-paritaire`), ordre des couches, gardes, règles de la légende |
| `legende/` | la légende unique (`legende-carte`) et ses blocs propres (score, bataille, zones du profil) |
| `filtre/`, `commun/` | puce du filtre actif ; annonce, boutons flottants, sélecteur de fond compact |

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
- **un outil d'analyse** : un composant dans `panneaux/analyse/`, son lancement gardé par
  `verifierPerimetreOutil('<outil>')` et déclaré dans `panneau-analyse-garde.test.ts`.
- **un onglet ou une entrée du rail** : `logique/navigation.ts` est une copie VERBATIM de React — on y touche
  avec React ; le rendu (entrée retirée, inerte) se décide dans `rail/rail.component.ts`.
