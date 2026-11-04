# Registre — finitions de ⑤ Jeu de zones (plan 2a75b9a8)
30/10 — Vincent : « je suis très reco » → Q-1..Q-7 = recos (Q-4 non ; Q-7 = vérif comptes par le trading, hors code).
- T0 + Groupe A (T1-T3) lancés. Puis relecture 1 → Groupe B (T4-T5) → relecture 2 → T6 (revue, preuve : build Next SANS surcharge d'env + next start :3002, ng serve :4202 ; tuer par PID) → Excel n° 50 et n° 22, archive, push.
- Groupe A fait : T0 eba925e8, T1 91ffa3ca, T2 3ffea61d, T3 d1cef86b, fin de groupe 56219039 ; sql/300 (plateformes_geo 17 lignes). ⚠ base partagée : les branches sans 'pays' dans MAILLES (carte-live, anciens carte-*) cassent ⑤ jusqu'à fusion. Unit 3044 verts. Relecture 1 lancée.
- Relecture 1 : 1 Moyen (FR non confirmé DV360/Meta/TikTok → arbitrage Claude : avertissement pays_a_verifier={FR}, aucun défaut changé) + mineurs → d92a32df. Groupe B (T4-T5) lancé.
- Groupe B fait : T4 30b33d86, T5 4e3de37e ; ng 3543/3543, unit 3048/3048. Relecture 2 lancée.
- Relecture 2 : 1 Moyen (course registre/recette sur zone pays venue de l'URL → lectures CP/cercles inutiles) + 4 faibles. Correctif lancé puis ARRÊTÉ par Vincent (30/10 nuit) → WIP commité (voir git log), NON vérifié.
- 31/10 : relecture 2 close (WIP b22e52a7 + correctif spec), sql/301 appliquée, ng 3545 + unit 3048 verts. Suivant : T6.
== RESUME HERE (v2) == → étape 4 ci-dessous (T6).
1. Lire le diff 4e3de37e..HEAD (WIP) ; finir les 5 points de la relecture 2 (liste ci-dessus et dans le retour du relecteur : signal « recette connue » ; spec pays qui prouve l'absence de lecture + cas FR→departement + recette après registre ; adopter remet _cibleChoisie ; infobulle TTD sur METRO via sql/301 ; commentaire lireCible).
2. sql/301 : vérifier si appliquée en local (note TTD METRO), sinon `docker exec -i supabase_db_genesis_app psql -U postgres -1 < sql/301_note_pays_par_ligne.sql` ×2.
3. ng test ciblé → tsc → ng test complet → npm run test:unit (une à la fois). Commit `fix(angular): … (⑤ finitions, relecture 2)`.
4. T6 : revue finale, preuve navigateur 2 thèmes (build Next SANS surcharge d'env, `next start -p 3002`, `ng serve --port 4202`, tuer par PID à la fin), docs, Excel n° 50 → Fait et n° 22 rattachée à ③, archive du registre, push.
03/11 — T6 revue finale : 0 C / 12 I / 18 M (t6-final-review.md). Ruling : I-1..I-11 corrigés maintenant (une vague) ; I-12 (fichiers serveur > 400 l.) reporté au grand nettoyage, jeu-zones.service.ts à 400 = au plafond, pas au-delà ; mineurs parqués pour la passation — coût si faux : fichiers longs plus durs à relire jusqu'au nettoyage.
- 03/11 — 137d070c fix(⑤ T6) 1/3 : I-1 (conseil d'une maille sans objet = les mailles qui restent à la plateforme, `phraseSansObjet` ; phrases serveur découplées de ④), I-2 (`mailleSansObjet(…, nationaleMoins)` : cercles/communes/IRIS/pays refusés sur « nationale moins zones locales », écran + POST/PATCH + extraction via `zone_pays_moins_base`), I-4 (disque hors France : « pays du territoire, DROM = pays distinct »). Extractions pures du service : `choixCourant`, `jeuModifie` (bilan.ts).
- 03/11 — f1411384 fix(⑤ T6) 2/3 : I-3 (maille exacte non carroyée = population inconnue, n_inconnues écran + extraction figée polygone/liste ; bandeau), I-5 (case catégorie spéciale remise à zéro : ouvrir/fermer/adopter un jeu, autre zone), I-6 (défauts provisoires dits avant « Enregistrer » et en-tête replié), I-7 (échec de simulation rendu : transitoire 429/réseau/5xx = défaut provisoire + raison immédiate ; refus métier = maille écartée, dite), I-10 (copie paritaire decouperEnBlocs, minimum contrôlé bloc par bloc). Fichiers neufs : decoupage-blocs.ts, ecran-population.ts (ecran.ts au plafond).
- 03/11 — eac80716 fix(⑤ T6) 3/3 : I-8 (regle_figee dans le résumé d'extraction ; en-tête du fichier ⑦ + badge ⑤/⑦ lus dans l'extraction, réserve « France entière »), I-9 (poids_groupe_cp, bornes polygone, plateformes_poids.parametres_a_verifier dits par paramètre), I-11 (tous les avertissements figés dans la liste des versions). Vérifs : tsc racine + Angular OK, test:unit 3329/3329, intégration (5 fichiers un par un) OK, specs Angular jeu/etat/activation OK. Reste : I-12 (nettoyage), jeu-zones.service.ts à 398 l.
T6 vague I-1..I-11 → 137d070c, f1411384, eac80716 (unit 3329/3329, 5 intégrations vertes, specs Angular). Parqués : mode de plan non remis à zéro (même défaut que I-5) ; simulation en échec temporaire non relancée ; écrêtages visibles seulement après extraction. Suivant : preuve navigateur 2 thèmes, Excel, archive, push.
- 04/11 — preuve T6 : E10 trouvé (rayon 5 km Pointe-à-Pitre, zone entièrement non carroyée → « couverture 0 % », « 0 manqué ») ; corrigé ef307686 (« inconnue », défaut « non chiffrables »), specs + tsc + ng complet (3 639 ; 4 rouges de délai sous charge, verts seuls). Captures s1-s6 du 03/11 + s4-drom-zone-inconnue-{clair,sombre}. ARCHITECTURE : clés `n_inconnues` / `regle_figee` du résumé d'extraction. Données de preuve supprimées (5 zones, 4 jeux, 3 extractions). Excel n° 50 → Fait, n° 22 rattachée à ③.
== ⑤ FINITIONS CLOSES (04/11) == Parqués pour la passation : I-12 (fichiers serveur > 400 l., grand nettoyage), mineurs de t6-final-review.md, mode de plan non remis à zéro, simulation en échec temporaire non relancée, écrêtages visibles seulement après extraction.

---

# Annexe — revue finale T6

# T6 — Revue finale de ⑤ Jeu de zones (état au HEAD 5ee397d3)

Revue en lecture seule, le 03/11. Worktree `carte-finitions`, branche `feat/carte-finitions`.
Lu : le plan ⑤ (T0-T6), son registre (RESUME HERE v2), le compte rendu du découpage (lots 1 à 4, B8-B16, C17-C29,
D30-D37), puis le code : `angular/…/carte/{panneaux/jeu, logique/jeu, etat/jeu-zones*}`, `app/api/zones/{jeux/**,
plateformes, [id]/cercles}`, `lib/zones/`. Registre `plateformes_geo` et `plateformes_poids` lus en base locale
(SELECT seuls, aucune écriture).

Pas de preuve navigateur dans cette revue : les scénarios ci-dessous sont tirés du code et du registre en base. Ils sont
à rejouer pendant la preuve T6 (:3002 / :4202).

## Comptes

| Gravité | Nombre |
|---|---|
| Critique | 0 |
| Important | 12 |
| Mineur | 18 |

Aucun point ne casse un achat sans que rien ne s'affiche. Le plus proche d'un critique est I-5 : la case « catégorie
spéciale » d'un jeu passe au jeu suivant, et l'écran pousse ensuite à l'enregistrer.

---

## Important

### I-1. TikTok, zone pays : « choisissez le code postal » alors que TikTok n'a pas de CP
- `angular/…/logique/jeu/conversion.ts:263-264` et `lib/zones/conversion.ts:266` (`MESSAGES_MAILLE_SANS_OBJET.decoupage_pays`,
  copie de `lib/zones/couverture.ts:103-104`) ; affiché par `panneaux/jeu/colonne-plateforme.component.ts:199-206`
  dans `choix-maille.component.ts:22-24`.
- Scénario : ③ « France métropolitaine » → ⑤. Dans la colonne TikTok, la pastille « Communes » est grisée avec
  « … est trop fin : choisissez le découpage par code postal. ». Juste à côté, la pastille « Codes postaux » est grisée
  avec « Pas de CP en France ». Sur la même zone, Meta « Cercles » dit « choisissez le pays ». La seule plateforme qui
  porte une ligne commune est TikTok, donc ce conseil n'est jamais applicable là où il s'affiche.
- On ne peut pas modifier la phrase de ④ : la copie est verrouillée. Il faut donc une phrase propre à ⑤ (« choisissez
  le pays ou le département »).

### I-2. « Nationale moins zones locales » (C21) : on retrouve l'écart E1 (conseil impossible à suivre, jeu qu'on ne pourra pas extraire)
- `conversion.ts:276-281` (`mailleSansObjet` ne connaît que `type === 'pays'`) ; `conversion.ts:394`
  (`zone_trop_vaste` : « augmentez le rayon ou réduisez la zone ») ; garde des routes `lib/zones/jeu-zone-routes.ts:133-141`.
- Scénario : France métropolitaine moins Lyon 30 km → ⑤ → Meta « Cercles ». Le pavage est refusé `zone_trop_vaste`
  (≈ 545 000 km² pour un plafond de 240 000 km²). L'écran conseille d'augmenter le rayon, ce qui reste refusé même à
  80 km. TikTok « Communes » : même phrase qu'en I-1. `POST`/`PATCH /api/zones/jeux` acceptent ces mailles : le jeu
  s'enregistre, puis l'extraction échoue. Le compte rendu (C21, mineurs parqués) le classe en « mineur ». C'est pourtant
  exactement E1, que le plan ⑤ classait Important.
- Correctif : étendre `mailleSansObjet` à la différence nationale. Il lui faut une information de plus : la recette
  seule ne dit pas que la première zone est une zone pays.

### I-3. Population inconnue affichée « 0 habitant » : la règle E10 / ARB-3 n'est pas tenue pour une maille exacte locale
- `logique/jeu/bilan.ts:277-284` : `popCercle` ne vaut `null` que pour un cercle. `resumeExact(cv.population…)` porte
  0, et `n_inconnues` n'est posé que pour le cercle. Affiché par `colonne-plateforme.component.ts:107`
  (`nombre(b.resume.population)`).
- Scénario : un rayon autour d'un point en Guadeloupe (non carroyée). Meta au cercle exact affiche « 1 cercle · 0
  habitants carroyés », puis « Diffusion à population inconnue : 1 cercle… » : deux lignes qui se contredisent. TTD au
  polygone affiche « 1 polygone · 0 habitants carroyés », sans ligne « inconnue ». Même chose pour une liste de CP exacte
  ou une composition exacte en DROM. Le bandeau du panneau affiche aussi « 0 habitants carroyés »
  (`panneau-jeu.component.ts:309-312`).
- Côté serveur : `lib/zones/extraction-jeu-zone.ts:261,266` fige `pop_en_zone = pop_totale = forme.population` (0) pour
  le polygone, sans `n_inconnues` (le contrôle, lui, reçoit bien `null`, l. 276).

### I-4. A3 conseille « Restreignez la campagne au pays FR » sur une zone de DROM
- `logique/jeu/ecran.ts:111-116` (`disque_hors_france`), alimenté par `conversion.ts:249-252`. Passation ⑦ du compte
  rendu, lot 1 : « un cercle + restriction au pays FR ».
- Scénario : rayon de 5 km sur la côte de La Réunion. Le disque déborde en mer, et l'avertissement dit de restreindre
  la campagne au pays FR. Or, d'après Q-2 et `codes_pays`, les plateformes traitent RE comme un pays distinct de FR :
  suivre le conseil couperait toute l'audience. Le texte doit nommer le pays du territoire (RE, GP…), lu dans
  `codes_pays`/`DEPARTEMENT_DROM`.

### I-5. La case « catégorie d'annonces spéciale » passe d'une zone à l'autre et d'un jeu à l'autre
- `etat/jeu-zones.service.ts:65` (`_categorieChoisie`) n'est remis à zéro nulle part : ni dans `choisirZone`
  (l. 205-213), ni dans `fermerJeu` (l. 336-341), `adopter` (l. 237-245), `ouvrirJeu` ou `appliquerUrl`. Lu en
  l. 97 et 126.
- Scénario : on coche la case sur le jeu A et on l'enregistre. On ouvre ensuite le jeu B depuis la bibliothèque (B a
  été enregistré sans la case). B s'affiche coché. Le registre lui applique le rayon minimal de 15 km de Meta, et un
  cercle Meta de 5 km s'affiche « l'extraction le refuse », ce qui est faux pour B. `modifie` vaut vrai, donc l'écran
  dit « Enregistrez les réglages avant d'extraire » et bloque « Extraire ». Si l'on enregistre, B passe en catégorie
  spéciale, alors que personne ne l'a demandé.

### I-6. Panneau étroit : le jeu enregistre des défauts provisoires que personne n'a vus
- `panneaux/jeu/panneau-jeu.component.ts:298` (`ouvertes` = la seule colonne dépliée) et `l. 345` (`valider` sur les
  colonnes ouvertes seulement) ; `logique/jeu/bilan.ts:108` (`choixDeBase` prend `defauts[p].maille`, provisoire
  compris) ; `enregistrer-jeu.component.ts:26,52-57` (bouton actif dès qu'un choix existe).
- Scénario : panneau sous 900 px, colonnes empilées, seule DV360 dépliée. On clique « Enregistrer le jeu ». TTD, Meta et
  TikTok partent avec leur défaut `en_attente` : aucune simulation n'a été lancée, aucun bilan n'a été affiché, et la
  phrase « provisoirement… » n'apparaît que dans une colonne dépliée. Le même geste sur un panneau large enregistre
  d'autres mailles. B9 autorise l'enregistrement pendant le défaut provisoire, mais pas sans le dire.

### I-7. Une simulation en échec (429 de quota compris) retire une maille du choix du défaut, sans le dire
- `etat/jeu-zones.service.ts:104-105` (`echec` = toute erreur de tâche), `l. 279-280` (une simulation en échec n'est
  jamais relancée) ; `logique/jeu/bilan.ts:150` (`'refusee'`) ; quota `geo:rl:conversion` à 6 par minute
  (`app/api/zones/[id]/cercles/route.ts:46`). Chaque essai de B10 prend un jeton.
- Scénario : sur une zone composite, le pavage Meta est refusé `trop_de_cercles`. La recherche du rayon proposé consomme
  jusqu'à 6 jetons, et les simulations « Cercles » de DV360 et de TTD reçoivent un 429. Les cercles sortent de la course
  au défaut. `erreurs` ne s'affiche que pour la maille choisie, donc rien ne dit que le cercle a été écarté faute de
  quota. Le défaut affiché est alors un autre que celui de la règle, et rien ne le relance.

### I-8. Le fichier de ⑦ omet des « à vérifier » réels, et lit le registre du jour plutôt que l'extraction
- `app/api/zones/jeux/[id]/extractions/[version]/fichier/route.ts:118-123,171` (`a_verifier` de la ligne, lu au moment
  du téléchargement) ; `lib/zones/fichiers-plateformes.ts:57,108` ;
  `panneaux/jeu/extractions-jeu.component.ts:141-144`.
- Scénarios :
  1. « France entière » au pays chez DV360, Meta ou TikTok. La ligne a `a_verifier = false`, mais le ciblage des DROM
     comme pays distincts reste à vérifier (`pays_a_verifier = {FR}`, figé dans le résumé : `pays_a_verifier: true`).
     Le CSV `pays` ne le dit pas, et le badge du bloc de fichiers non plus.
  2. DV360 au CP : `max_unites` est « non relevé » (C28) et `poids_groupe_cp` est à vérifier, mais le fichier se dit
     confirmé.
  3. Une mise à jour de `plateformes_geo` après l'extraction change l'en-tête d'un fichier figé. Le reste de
     l'extraction ne bouge pas (Review Focus 3).

### I-9. Règle 3 : des paramètres « à vérifier » n'apparaissent jamais dans ⑤
- `logique/jeu/parametres-a-verifier.ts:15` (`BORNES`) ignore `poids_groupe_cp`, `polygone_sommets_max` et
  `polygone_morceaux_max`. L'en-tête (l. 6) dit que ces paramètres ont « leur propre avertissement » : c'est faux pour
  `poids_groupe_cp`, que `groupes_cp_partiels` ne marque pas. Les `parametres_a_verifier` de `plateformes_poids`
  ne sont lus nulle part dans ⑤ (DV360 : plage 0,1 à 10 et `nb_max_entrees` 2 000 ; TTD : plage et plafond nuls ;
  Meta et TikTok : `mecanisme`).
- Scénario : DV360 au CP. La colonne dit « À vérifier : codes postaux par liste, non relevé. », mais rien sur la règle
  de groupe ni sur la plage du multiplicateur. Pourtant ces deux valeurs décident de ce que reçoit la plateforme
  (compte rendu, D34 : « un poids écrêté à 10 part chez TTD sans que l'écran le dise »).

### I-10. Découpage en blocs : ⑤ contrôle le minimum sur la maille entière, l'extraction bloc par bloc
- `logique/jeu/bilan.ts:289` : `controlerPopulation` reçoit un résumé sans `decoupage`, donc un seul groupe. Côté
  serveur, `lib/zones/extraction-jeu-zone.ts:364,377` pose `decoupage`, et `conversion-population.ts:87` contrôle
  chaque bloc. `decouperEnBlocs` (`lib/zones/decoupage-blocs.ts`) n'a pas de copie Angular.
- Scénario : TikTok aux communes, 3 001 communes retenues. ⑤ annonce « découpage automatique en 2 blocs (3 000 + 1) »
  sans avertissement. L'extraction fige ensuite « Bloc 2 : palier sous 1 000 personnes… ». Le comportement est
  `avertissement` aujourd'hui. S'il passe à `refus` au registre, ⑤ affichera une maille valide que l'extraction refusera.

### I-11. Les avertissements figés à l'extraction ne s'affichent pas dans la liste des versions de ⑤
- `panneaux/jeu/extractions-jeu.component.ts:136` ne garde que `a.bloc !== undefined`.
- Scénario : DV360 au CP en mode pondéré. L'extraction ramène des multiplicateurs à ×10 (`multiplicateur_max`), découpe
  les envois (`nb_max_entrees`), fige `pays_a_verifier` ou `pop_min_*`. ⑤ affiche « Extraction v1 enregistrée : elle
  ne bougera plus. » sans aucun de ces ajustements, qui ne se voient qu'en ⑦. Ils ne sont jamais calculés avant
  l'extraction : la règle 5 n'est donc tenue qu'en aval.

### I-12. `etat/jeu-zones.service.ts` est de nouveau à 400 lignes, au plafond
- Le plan ⑤ classait ce point Important en E3 (T0 visait 360 lignes au plus). Le fichier est revenu à 400 avec B16,
  C29 et D33. La moindre ligne ajoutée fait échouer `taille-fichiers.test.ts`. Le fichier Angular `logique/jeu/conversion.ts`
  en compte 398.

---

## Mineur

| # | Fichier:ligne | Constat et scénario |
|---|---|---|
| M-1 | `etat/jeu-zones.service.ts:117` | Un `?mailles=meta.cercle` sur une zone pays est **ignoré sans le dire** (règle 5), puis gardé et réécrit dans l'URL (`ecrire`, l. 395). Un lien partagé d'une zone locale vers une zone pays fait retomber au défaut sans aucune phrase. |
| M-2 | `jeu-zones.service.ts:65` | La catégorie spéciale n'est pas dans l'URL, contrairement à la cible et au mode (E6). Un lien partagé la perd. |
| M-3 | `panneau-jeu.component.ts:310` ; `ecran.ts:309-311` ; `conversion.ts:346-349` | Cible ≠ `ind` : le bandeau dit « habitants carroyés » pour une population de cible. `texteUnitePays` dit « habitants ». La maille pays n'a pas `diffusion_population_totale` alors que les autres mailles exactes l'ont (cohérent avec le mineur C24 parqué, mais visible). |
| M-4 | `colonne-plateforme.component.ts:111-115` | « France entière » : GP, GF et YT sont dits deux fois, une ligne « population inconnue (non carroyée) » par territoire, puis « Diffusion à population inconnue : 3 pays… ». |
| M-5 | `bilan.ts:168` / `extraction-jeu-zone.ts:254-261` | D37 : le polygone s'affiche « Exacte : aucune perte » dans ⑤, puis l'extraction le simplifie toujours à 50 m (perte et gain). La simplification n'est pas annoncée avant d'extraire. |
| M-6 | compte rendu D36 / `panneaux/jeu/*` | Le compte rendu dit « Surface du référentiel affichée en ⑤ » : aucun fichier de ⑤ ne lit `surface_inconnues`, la surface n'est affichée qu'en ④. `avertissementNonCarroye` (zone à cheval sur un territoire non carroyé) n'est pas affiché non plus dans ⑤. |
| M-7 | `colonne-plateforme.component.ts:236-240` | D33 : pendant la première seconde, le défaut provisoire s'affiche chiffré, sans aucune mention, et peut s'enregistrer. |
| M-8 | `app/api/zones/[id]/cercles/route.ts:84-105` | La route n'applique pas `regleCategorieSpeciale` : un rayon de 5 km enregistré auparavant, puis la case cochée, donne un pavage à 5 km et éventuellement « Passer à 8 km » (`colonne-plateforme:97-100`), deux rayons que l'extraction refusera (minimum 15 km). |
| M-9 | `colonne-plateforme.component.ts:82` | Case cochée après coup : `rayonLocal` reste à 5 km sous un `min` de 15 km. Le libellé dit « 5 km » alors que le curseur est à 15. |
| M-10 | `ecran.ts:59,71` ; `ecran.ts:48` | « Pays par défaut (export manuel) » : il n'y a rien à exporter (« à poser dans la plateforme »). `UNITE_MAILLE.pays.titre` « Dilution au pays » n'est jamais affiché. |
| M-11 | `choix-maille.component.ts:20-24`, badge `colonne-plateforme:62` | Les notes de `plateformes_geo` sont affichées telles quelles, avec les identifiants internes et le jargon : « Q-B : aucun ciblage par rayon… (1 km minimum selon des blogs) », « Q-C : CP français (clé FR:75001)… Sans poids : paliers », « script de custom bidding ». |
| M-12 | `lib/zones/extraction-jeu-zone.ts:177,182,457` ; `conversion-serveur.ts:113-127` ; route `fichier:59-61` | Les messages du serveur affichés à l'écran portent les identifiants bruts : « dv360 — … », « ttd — aucune unité retenue… », « La plateforme meta n'achète pas… », et « 1000 m » sans `formaterNombre` dans un cas. Apostrophes droites (`'`) dans la route `fichier`. |
| M-13 | `ecran.ts:295-302,73,59,109,113-115` ; `colonne-plateforme:292` ; `couverture.ts:141-142` | Textes techniques ou longs : la formule « √(surface / π) / 3 pour 20 km² », « faute de simulation : la plus sûre, puis exacte, puis poussée par API, puis la plus fine », « cellules examinées », « ciblage par API, poids en export manuel », `disque_hors_france` (3 phrases), « liste de codes n'est pas matérialisée », le mot « découpage » avec « (48 872) / (34 918) » dans ⑤. |
| M-14 | `ecran.ts:228-233` ; `extractions-jeu.component.ts:130` | « 2 blocs de 3 000 au plus : bloc 1 3 000 (…) » se lit mal. Le résumé de version affiche « The Trade Desk : pays 1, exacte ». |
| M-15 | `parametres-a-verifier.ts:19` ; `plateformes.ts:19,43` | `max_sommets` est un libellé et une limite morts (la base emploie `polygone_sommets_max`), et les deux noms coexistent dans `PARAMETRES_VERIFIABLES`. |
| M-16 | `jeu-zones.service.ts:243` | `adopter` remet `_cibleChoisie` à `null`. Quand on quitte le jeu pour une autre zone, la cible retombe sur « tous les habitants » au lieu de la dernière choisie. |
| M-17 | `lib/zones/couverture.ts:141-142` | `MESSAGE_ZONE_NATIONALE_MOINS` dit « extraction par code postal ou par département ». Le défaut de TTD sur cette zone est le polygone (exact), et Meta n'a que le CP. Le message de « Mes zones » ne décrit pas ce que ⑤ proposera. |
| M-18 | voir § 5 | Fichiers serveur de plus de 400 lignes, que `taille-fichiers.test.ts` (limité à `angular/src`) ne surveille pas. |

---

## 3. Règle 5 et « à vérifier » par paramètre : bilan

- Ajustements silencieux trouvés : M-1 (choix d'URL ignoré), I-6 (défaut provisoire enregistré), I-7 (maille écartée
  sur un 429), I-11 (écrêtages et découpages d'envoi jamais dits dans ⑤), M-5 (simplification du polygone).
- Ce qui est bien tenu : un rayon ajusté (B8) se dit avant et après, `max_unites` (B14) aussi, les cercles écartés
  par le minimum (B13), le chevauchement des disques (A6), les groupes partiels (B15), le rayon proposé (B10), qui
  n'est jamais appliqué d'office, et le refus `trop_de_cercles` chiffré (E4).
- « À vérifier » par paramètre : bien tenu pour `max_unites`, les rayons, `pop_min_*` (valeur ou comportement) et
  `rayon_min_categorie_speciale`. Manquent `poids_groupe_cp`, `plateformes_poids.parametres_a_verifier` et les
  bornes du polygone (I-9). Le fichier de ⑦ n'a qu'un indicateur par ligne, lu au moment du téléchargement (I-8). La
  réserve « France entière » ne se lit qu'au survol (`title`), donc jamais sur écran tactile.

## 4. Design

- Jetons : aucun hexadécimal ni `rgba` dans `panneaux/jeu`, `couche-jeu` ou `jeu-carte.service`. Les paliers passent
  par `var(--seq-n)`, le badge « À vérifier » est neutre (`border-default`, `bg-overlay`, `text-tertiary`), sans
  couleur de statut. Rien à signaler sur les deux thèmes à la lecture. Le contraste en clair reste à mesurer dans la
  preuve (n° 45 hors lot).
- Sentence case et vouvoiement : conformes dans les textes écrits côté Angular. Les écarts viennent du serveur et du
  registre (M-11, M-12).
- Textes trop longs ou trop techniques : M-13. Les plus visibles sont la ligne du défaut (B9/B16) et celle du rayon
  par défaut (B10), qui exposent la règle et la formule plutôt que ce que la personne doit faire.

## 5. Fichiers de plus de 400 lignes, et ce qui reste dupliqué

**Au-dessus du plafond, ou au plafond (hors `*.spec.ts`) :**

| Fichier | Lignes | Couvert par le test ? |
|---|---|---|
| `lib/zones/extraction-jeu-zone.ts` | 623 | non (dette déjà notée : extraire `controler`) |
| `lib/zones/plan.ts` | 554 | non |
| `app/api/zones/jeux/[id]/extractions/[version]/export/route.ts` | 459 | non |
| `app/api/zones/jeux/[id]/export/route.ts` | 418 | non |
| `lib/zones/conversion.ts` | 401 | non (sa copie Angular est à 398) |
| `angular/…/etat/jeu-zones.service.ts` | **400** | oui, au plafond (I-12) |
| `app/api/zones/jeux/[id]/extractions/route.ts`, `lib/zones/recette.ts` | 399 | non |

Spec seule au-dessus du plafond : `etat/jeu-zones.service.spec.ts` (455), exemptée par le test.

**Ce qui reste dupliqué :**
1. **Copies paritaires verrouillées** (voulues, par construction) : `conversion`, `conversion-defaut`,
   `conversion-population`, `conversion-rayon`, `exactitude-composition`, `plateformes` (lib ↔ Angular) ; `formatsDe`
   (`fichiers-plateformes.ts` ↔ `logique/activation/cartes.ts`) ; `MESSAGES_REFUS_COUVERTURE` (types) ;
   `MESSAGES_MAILLE_SANS_OBJET.decoupage_pays` = `decoupage_trop_fin_pays` (copie déclarée, et cause de I-1).
2. **Asymétries, logique d'un seul côté** (sources d'écarts entre l'écran et l'extraction) : `decouperEnBlocs`, côté
   serveur seulement (I-10) ; `texteSimplification`, côté Angular seulement (compte rendu D37) ; `NOM_PLATEFORME`,
   côté Angular seulement, d'où les identifiants bruts des messages du serveur (M-12).
3. **Petits doublons Angular** : quatre façons d'écrire des kilomètres (`ecran.distance`, `colonne-plateforme.km`,
   `parametres-a-verifier.valeur`, `fichiers-plateformes.km` côté serveur) ; `capitale()` (`colonne-plateforme`)
   et des `charAt(0).toUpperCase()` en ligne (`ecran.ts:70,158,202`).
4. **Deux sources de vérité temporaires** : le plan CP commun (`zone_set_extraction_cp`, déprécié D32) et le plan par
   plateforme (B12), jusqu'à ce que ⑥ et ⑦ lisent ce dernier ; les colonnes `_e7` de C25 jusqu'au merge ;
   `unites_constitutives` hors du JSON `recette` (B15).
5. **Reportés au nettoyage final (n° 39)** : points 14 (groupe de CP → canonique, écrit deux fois) et 15
   (`JeuxApi` / `JeuxZonesApi`) du lot 5.

## 6. Couverture des cas demandés

| Cas | Verdict |
|---|---|
| Rayon | OK : B8 (< 250 m refusé, ajusté et dit), A3 (I-4 pour les DROM), B10. Catégorie spéciale : I-5, M-8, M-9 |
| Polygone | OK à l'écran ; M-5 (simplification non annoncée), I-3 (polygone en DROM non carroyé) |
| Zone nationale | OK (pays d'office, aucun carreau lu, unités figées) ; I-1, I-8, M-4, M-10 |
| Nationale moins des zones locales | I-2, M-17 |
| DROM | I-3, I-4, I-8 ; affichage « non carroyée » des unités pays : OK |
| Catégorie spéciale Meta | I-5, M-2, M-8, M-9 |
| Découpage en blocs | I-10, M-14 ; fichiers par bloc dans ⑤ : OK (`blocsFichier` passé) |
| Simulation en cours (D33) | I-6, I-7, M-7 |
