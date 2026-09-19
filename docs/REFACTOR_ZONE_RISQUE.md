# Rapport de refactor — « zone à risque industriel »

> Exécution du plan de `docs/AUDIT_ZONE_RISQUE.md`, le 2026-09-19.
> Périmètre strict : couche carte, deux écrans de l'overlay, sept routes.

---

## Résultat

**21 des 28 constats traités.** Les 7 restants sont listés en §4 avec la raison.

| Vérification | Avant | Après |
|---|---|---|
| `npm test` | 1 434 + 36 | **1 452 + 36**, verts |
| `npx tsc --noEmit` | propre | propre |
| `npm run lint` | avertissements préexistants | **0 erreur**, mêmes avertissements |
| `npm run catalogue` | — | **0 export mort** |
| Filet de caractérisation | 8/8 | **8/8, valeurs identiques** |

Les cinq valeurs de référence n'ont pas bougé : 423 893 exposés · 96 unités ·
1 259 sites · couverture 100 % · 42 409 940 à 10 km · 482 sites sur l'Étang de
Berre (120 `pprt` / 4 `non_soumis` / 358 `non_concerne`) · 12 périmètres PPRT.

---

## 1. Ce qui a été corrigé

### Deux failles d'I/O — et c'était le même défaut

`R-01` et `R-02` avaient le même visage : **une intention écrite en commentaire
que rien n'appliquait.**

- `/api/risques/[siteId]/exposition` n'avait aucun quota, alors qu'elle calcule
  (~300 ms sur 2,3 M carreaux) **et** écrit. `siteId` étant énumérable sur
  99 152 sites, une boucle réalisait le « pré-calcul de masse » que l'en-tête du
  fichier déclare refuser.
- `/api/map/risques-industriels` annonçait « bbox absente ⇒ réservé aux
  Seveso ». Rien ne l'appliquait : `?gravites=autre&limite=5000&rayon_m=20000`
  sans bbox balayait 41 690 sites et sérialisait 5 000 `ST_Buffer` de 20 km.

La règle **refuse** désormais au lieu de rogner : une carte incomplète
présentée comme complète est pire qu'un refus, parce qu'invisible.

### Des écouteurs qui s'empilaient, et multipliaient la faille précédente

`R-03`/`R-04`. Les gestionnaires de clic étaient posés dans la branche de
**création** de couche ; `nettoyer()` supprimait la couche sans `off()`. Chaque
cycle décocher/recocher en ajoutait un. Après N cycles, **un clic déclenchait N
appels** sur la route non quotée.

`PprtLayer` résolvait déjà exactement ce cas et le documentait : la correction
n'existait que d'un côté. Les deux couches ont maintenant le même cycle de vie,
et vont un cran plus loin — les écouteurs sont aussi retirés au démontage,
`removeLayer` ne le faisant pas.

### Dix-neuf copies de cinq règles

`R-06`, `R-08`, `R-16`, `R-17`, `R-18`, `R-19`, `R-24`. Plusieurs avaient déjà
**divergé**, ce qui est le moment où une duplication cesse d'être un désagrément
pour devenir un bug :

- `fInter`/`fMono` : les trois fichiers de `components/risques/` omettaient le
  repli `Fira Mono` — le design system sautait sur tout l'écran d'analyse.
- `toFixed(1).replace('.', ',')` : six occurrences, dont une côté serveur.
  Septième variante de DUP-001.
- Trois listes blanches de maille (5 / 4 / 4) : `arrondissement` était
  **inatteignable**, refusé en 400 par `/agregats` et accepté par `/export`.
- `modes` : `/agregats` validait, `/export` non. Pour `?modes=xxx`, l'un
  répondait « les deux modes », l'autre **un classeur vide sans message**.

Nouveaux modules : `lib/api/parametres-requete.ts`, `lib/design/polices.ts`,
`lib/risques/dimensions.ts`, `lib/risques/methode.ts`,
`components/risques/Kpi.tsx`, `components/risques/elements.tsx`.

### Le design system, violé puis rétabli

`R-05` : huit couleurs hexadécimales en dur, sans variante de thème clair, dans
un fichier qui prouvait trois lignes plus bas que `var()` fonctionne dans
Recharts. Seize jetons `--nature-1..8` rejoignent `globals.css`.

**Pas de duplication en TypeScript ici**, contrairement aux échelles divergente
et séquentielle : celles-là alimentent MapLibre, qui ne résout pas `var()` dans
`paint` ; Recharts le résout.

`R-12` : le cerne du point n'était pas indexé par le thème — sur fond clair, un
cerne blanc ne détoure plus rien.

`R-13` : la légende écrivait `1px dashed`, où le **navigateur** choisit la
longueur des tirets, quand la carte dessine `[2, 2]`. Elle montrait donc un
trait que la carte ne dessine pas — exactement ce que son propre en-tête
déclarait éviter.

### Un chiffre qui n'était pas daté

`R-14`. Vérifié en base : les chiffres de l'écran sont **justes** (99 152 ICPE,
1 327 Seveso, 664 PPRT sur 87 départements) — c'est `ARCHITECTURE.md` qui citait
un compte de production périmé. Ils sont désormais dans un `RECENSEMENT` unique
et **daté**, comme le bloc voisin du même fichier le faisait déjà.

### Une performance qui coûtait 10 000 sérialisations par panoramique

`R-22`. Deux `JSON.stringify` par site à chaque `moveend`, jusqu'à 5 000 sites,
pour des chaînes ré-analysées ensuite pour le **seul** site cliqué. Remplacé par
une table indexée par identifiant.

---

## 2. Un défaut trouvé en chemin, hors du plan

**La suite de tests mentait.** En ajoutant un fichier d'intégration lourd, j'ai
rendu visible une fragilité qui existait déjà : un test **différent** échouait à
chaque exécution, ce qui se lisait comme une régression du test concerné.

Deux causes, et la seconde n'a été trouvée qu'en lisant les journaux de Kong :

1. Vitest exécutait les 150 fichiers unitaires **en même temps** que les tests
   d'intégration, sur les 4 vCPU de la VM partagés avec Postgres. `npm test`
   fait maintenant deux passes successives.
2. `recv() failed (104: Connection reset by peer) while reading response header
   from upstream` — PostgREST ferme une connexion persistante au moment où Kong
   la réutilise ; Kong traduit en **502**, et supabase-js en « An invalid
   response was received from the upstream server ». **Aucune erreur
   n'apparaît dans les journaux de PostgREST.**

Corrigé dans le **harnais** (`tests/integration/_client.ts`), jamais dans
`lib/` : c'est une particularité du stack local, et ajouter une reprise au
produit lui ferait porter une dette qui n'est pas la sienne — en masquant un
vrai 502 le jour où il arriverait. Reprise limitée aux lectures, aux codes
502/503, et à **une** fois : deux coupures d'affilée ne sont plus une course
mais une panne. Vérifié : 5 exécutions consécutives à 36/36.

---

## 3. Ce qui n'a pas été cassé

Le périmètre a une densité inhabituelle de garde-fous **mesurés**. Aucun n'a
bougé, et le filet de caractérisation le prouve :

- la distinction `pprt` / `buffer` et le drapeau `indicatif`, de bout en bout ;
- la convention plein/tireté (`lib/carte/nature-zone.ts`), qui a été **inversée
  pendant un mois** ;
- « la colonne sites ne s'additionne pas », à quatre endroits ;
- `--donnee-absente` ≠ valeur faible ; DROM : donnée absente ≠ exposition nulle ;
- les plafonds venant de la BASE et non recopiés côté client ;
- le `useMemo` sur `perim` — sans lui, un calcul de 4 s tournait en boucle ;
- la projection Mercator en radians, et la séparation métropole/outre-mer par la
  **géographie** et non le code INSEE.

---

## 4. Ce qui reste, et pourquoi

| ID | Ce qui reste | Pourquoi |
|---|---|---|
| **R-07** | `AnalysePopulationOverlay.tsx` fait encore **1 403 lignes** (seuil : 300) | Les briques présentationnelles sont sorties. Le corps porte **dix-sept `useState`** : le découper impose un contexte ou un réducteur, donc une RESTRUCTURATION — pas un refactor à comportement constant. À arbitrer séparément. |
| **R-06** (libellés) | « Seveso haut » vs « Seveso seuil haut » | Choix produit : lequel fait foi ? |
| **R-09** (interface) | `arrondissement` reste non proposée à l'écran | Les deux routes l'acceptent maintenant. L'exposer est une décision produit, pas une dette. |
| **R-15**, **R-20** | Les filtres de l'overlay ne remontent pas au panneau ; deux listes de rayons | Changements de comportement visibles. Choix produit. |
| **R-21** | Deux `as unknown as` dans `/agregats` | Le contrat de la RPC est décrit à trois endroits, aucun complet. Le corriger demande de typer le retour de `population_exposee_agregee` en entier — utile, mais c'est un chantier de types, pas ce lot. |
| **R-25**, **R-27**, **R-28** | try/catch manquant sur `writeBuffer`, un cast gardé à distance, trois balayages dans `CarteMiniFrance` | Gravité basse, aucun effet mesuré. |
| Couverture de tests | Toujours **non mesurable** | Aucun provider installé. L'exigence « >80 % » de `production-clean-code` reste invérifiable ; ajouter `@vitest/coverage-v8` est une dépendance, donc une décision. |

**Dette signalée hors périmètre**, non touchée : `fInter`/`fMono` sont encore
redéclarés dans sept fichiers ailleurs dans le dépôt (`ClusteringWizard`,
`ClusterPanel`, `DiffusionMapLayer`…). `lib/design/polices.ts` existe désormais
pour les accueillir.

---

## 5. Commits

| | |
|---|---|
| `d583d5f` | filet de caractérisation |
| `34b8f6c` | R-01, R-02 — les deux failles d'I/O |
| `ceee900` | R-03, R-04 — écouteurs empilés, et la suite de tests qui mentait |
| `28bcd3f` | R-08, R-17, R-18, R-19, R-24, R-26 — dédoublonnage |
| `fe2db99` | R-05, R-12, R-13 — design system |
| `b4eff4c` | R-09, R-10, R-11, R-14 — listes blanches, et la course Kong/PostgREST |
| `37d1b57` | R-07 partiel, R-23 — découplage |
| `3704b98` | R-22 — performance |
