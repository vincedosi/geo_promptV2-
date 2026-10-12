# risques — « Population à risque industriel »

**Rôle** : le module risque (lot 3), portage de `AnalysePopulationOverlay.tsx` : cinq étapes — ① Sites,
② Rayon, ③ Couverture, ④ Zones (jeux de zones, conversion en codes postaux), ⑤ Campagne (simulation de
diffusion et recalage).

**Route** : `carte/risques`, ENFANT de la carte principale (`/app/carte/risques`) : rendu par l'outlet de la
carte, en surimpression, la carte intacte dessous. L'ancienne adresse `risques` redirige ici. Tout l'état
partageable vit dans UN paramètre d'URL, `?risque=` (même encodage que React : une URL React se colle telle
quelle).

**Entrée** : `risque.page.ts` (+ `.html`) — en-tête, fil des étapes, barre commune, bandeau KPI, panneau
d'étape (`@switch`), cartes. Fermer (croix, Échap) navigue vers le parent RELATIF.

**Services d'état** (fournis par la page, détruits avec elle) :

| Service | Tient |
|---|---|
| `etat/etat-risque.service.ts` | l'état d'URL `?risque=` (lecture, écriture par le `Router`, jamais `history`) |
| `etat/donnees-risque.service.ts` | les chargements partagés (bandes, courbe, sites, référentiel, contours) — les règles d'I/O sont là |
| `etat/atelier-jeux.service.ts` | le jeu de zones ouvert et son réglage (étape ④) |
| `etat/simulation.service.ts` | la simulation de l'étape ⑤, lue par le panneau, le bandeau, la carte et le tableau |
| `ChargementService` (core) | la barre de progression commune |

**Sous-dossiers** :
- `commandes/` — barre commune (cible, maille, territoire, réglettes), bandeau KPI, profil des anneaux, fil
  des étapes (`etapes.ts`).
- `etapes/<étape>/` — le panneau de chaque étape et ses tableaux.
- `cartes/` — `vue-cartes` (cadre : une carte, ou deux liées à ④), `carte-risque` (rayons), `carte-codes-postaux`
  (④), `carte-campagne` (⑤), et les couches pures de la carte des rayons (`couches-sites.ts`,
  `couches-zones.ts`). ⚠ **Une carte ne se démonte jamais** : masquée par largeur nulle et
  `visibility`, jamais sous un `@if`.
- `logique/` — règles pures : copies de `lib/risques`, `lib/simulation` (sous `simulation/`), verrouillées par
  les tests `*-paritaire` de la racine ; et la logique propre aux composants (`carte-campagne.ts`,
  `carte-codes-postaux.ts`, `panneau-campagne.ts`, `donnees-risque.ts`).
- `data/` — services d'API ; `exports/` — boutons d'export (Bearer) et « Voir sur la carte » ; `testing/` —
  fixtures des specs.

**Ajouter un chiffre ou une colonne** : le calcul vient du serveur ou d'une fonction de `logique/` ; le
composant ne fait que lire. Un chargement nouveau passe par `DonneesRisqueService` (clé texte → `Subject` →
`switchMap`), jamais par un appel direct depuis un panneau.

**Ajouter une étape** : son identifiant dans `logique/etape.ts`, son libellé dans `commandes/etapes.ts`, son
panneau dans `etapes/<nom>/`, monté par le `@switch` de `risque.page.html`.
