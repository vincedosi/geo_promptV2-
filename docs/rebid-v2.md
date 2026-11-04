# Spec : correction des poids v2 (rebid) et script custom bidding

Statut : à implémenter. Référence : `docs/algorithme-optimisation-impressions.docx` (version 26/10/2026), chapitres 10, 11, 15.
Objectif : rendre la boucle quotidienne (étapes 4 à 8) stable et effectivement appliquée par DV360.

Ne rien changer aux étapes 1 à 6 (plan, part, prévu, rollups, pacing, mesures d'écart) sauf les points explicitement listés en section 6.

---

## 1. Décisions

| # | Décision | Remplace |
|---|----------|----------|
| D1 | Une seule formule de correction : la variante amortie, réécrite ci-dessous | `computeRebidWeights` (rebid plafonné) et `recaler` (amortie actuelle) |
| D2 | La cible de correction est le **reste à livrer**, pas la part initiale du plan | `part_prévue / part_livrée` sur le cumul |
| D3 | La livraison observée est une **fenêtre glissante de 7 jours** (fallback 3 jours en début de campagne) | livraison cumulée ou J-1 |
| D4 | Correction **hiérarchique** : département puis CP, avec rétrécissement des CP vers leur département | correction CP seule |
| D5 | Le facteur dilution ×0,6 sort de la correction. Il est appliqué **une fois** dans le plan (étape 1, méthode B) | ×0,6 à chaque itération dans `recaler` |
| D6 | Paliers custom bidding par **valeur de poids** (bornes fixes), scores explicites | 5 quantiles par rang |
| D7 | Score hors zone en mode national = `0,8 × min(poids cible)` | hors zone fixé à 1 |

---

## 2. Formule de correction v2

Notations, pour une campagne, une plateforme, à la date J (dernière journée de livraison disponible) :

```
N            = nombre total de jours de la campagne
j            = nombre de jours écoulés (J inclus), borné à [1, N]
R            = N − j                     jours restants (si R = 0 : pas de correction)
I_total      = impressions prévues sur la campagne (étape 3)
prevu(z)     = part_plan(z) × I_total    impressions prévues de la zone sur la campagne
livre_cum(z) = impressions livrées cumulées de z jusqu'à J
F            = min(7, j)                 taille de la fenêtre (3 minimum, sinon pas de correction)
livre_fen(z) = impressions livrées de z sur les F derniers jours
```

### 2.1 Cible journalière restante

```
reste(z)        = max(0, prevu(z) − livre_cum(z))
cible_jour(z)   = reste(z) / R
cible_part(z)   = cible_jour(z) / Σ_z cible_jour(z)          part cible de la zone pour les jours restants
obs_part(z)     = livre_fen(z) / Σ_z livre_fen(z)             part observée sur la fenêtre
```

Si `Σ cible_jour = 0` (plan entièrement livré) : pas de correction, poids inchangés, alerte « plan atteint ».

**Dénominateur de la part observée (amendement E8).** `Σ_z livre_fen(z)` porte sur **toutes** les impressions de la plateforme sur la fenêtre : CP du plan + `HORS_ZONE` (amendement E3), et non sur les seuls CP du plan, ce qui gonflerait les parts (la campagne Adform montre 89 CP livrés sans population connue). Les CP de `cp_geoloc_defaut` (ci-dessous) sont retirés du numérateur et du dénominateur.

**Taux de fuite.** Taux de fuite = `obs_part(HORS_ZONE)`. Alerte au-delà d'un seuil réglable par campagne (section 6, P5).

**CP par défaut de géolocalisation.** Table `cp_geoloc_defaut` : liste manuelle + critère statistique proposé (rapport impressions / population > 5 et CP de centre-ville). Ses CP sont neutralisés dans la correction : `corr` forcée à 1, poids gelé, exclus de la part observée, et signalés dans le suivi. Sans cela, un CP par défaut présent dans le plan est corrigé en boucle, et sa baisse de poids pénalise les vrais habitants du CP. Exemple : 75001 reçoit 3,46 % des impressions de la campagne Adform pour 14 421 habitants ; l'hypothèse d'un CP par défaut reste à vérifier par dentsu sur une campagne datée.

### 2.2 Correction au niveau département (ou sous-zone)

```
ratio_dep(d)   = cible_part(d) / max(obs_part(d), eps)      eps = 1e-6 (unité : part, entre 0 et 1)
corr_dep(d)    = clamp(ratio_dep(d), 1/3, 3) ^ alpha        alpha = 0,8
```

### 2.3 Correction au niveau CP avec rétrécissement

```
ratio_cp(cp)   = cible_part(cp) / max(obs_part(cp), eps)
corr_cp_brut   = clamp(ratio_cp(cp), 1/3, 3) ^ alpha

n(cp)          = livre_fen(cp)                              impressions observées du CP sur la fenêtre
k              = 200                                        constante de rétrécissement (réglable)
lambda(cp)     = n(cp) / (n(cp) + k)                        0 si rien observé, → 1 si beaucoup

corr(cp)       = corr_dep(dep(cp)) ^ (1 − lambda(cp)) × corr_cp_brut ^ lambda(cp)
```

Lecture : un CP qui a peu d'impressions suit la correction de son département ; un CP bien observé suit la sienne. Moyenne géométrique pondérée, donc en échelle log.

### 2.4 Mise à jour et renormalisation

```
brut(cp)       = poids(cp) × corr(cp)                        CP actifs du plan
poids_v2(cp)   = brut(cp) / moyenne(brut)                    moyenne arithmétique non pondérée = 1
poids_v2(cp)   = clamp(poids_v2(cp), min_mécanisme, max_mécanisme)
                                                             plage du mécanisme lue dans le registre ;
                                                             0,001 / 999,999 si inconnue
(pas de renormalisation après écrêtage)
```

Ordre des opérations (amendement E4) : normaliser **puis** écrêter, jamais l'inverse ; c'est la même séquence que le plan par CP (ticket A1 du plan de corrections). Après écrêtage, la moyenne n'est plus forcément 1 : le résultat expose la moyenne obtenue après écrêtage et le nombre de CP écrêtés. La convention « moyenne non pondérée » est un paramètre explicite (`normalisation`, défaut `'non_ponderee'`, section 6 P5), car elle fixe la dérive du coût moyen après correction. La ligne `HORS_ZONE` n'entre pas dans la moyenne.

CP du plan jamais servi (`livre_cum = 0`) : il doit exister dans le calcul avec `obs_part = 0`, donc `ratio = clamp(…, 1/3, 3) = 3`, `corr = 3^0,8 ≈ 2,41` au niveau brut, puis rétréci vers son département (lambda = 0 → suit le département). Voir section 6, point P2.

### 2.5 Invariants à tester

```
INV1  si obs_part(z) = cible_part(z) pour tout z     ⇒ poids_v2 = poids (à 1e-9)
INV2  moyenne(poids_v2) = 1 avant écrêtage (moyenne arithmétique non pondérée) ; après écrêtage,
      la moyenne obtenue et le nombre de CP écrêtés sont exposés
INV3  corr(cp) ∈ [3^-0,8, 3^0,8] = [0,415, 2,408]
INV4  un CP avec livre_fen = 0 a corr(cp) = corr_dep(dep(cp))
INV5  réponse proportionnelle simulée (a = w·r / Σ w·r) : l'erreur log moyenne est multipliée par ≤ 0,25 par itération,
      pour λ ≈ 1 seulement (CP bien servis) ; un CP peu observé suit son département (amendement E10)
INV6  cible_part reste identique entre deux itérations si la livraison suit exactement cible_jour (pas de dérive de la cible)
INV7  le ×0,6 n'apparaît nulle part dans la correction (grep)
INV7b simulation avec un CP par défaut (cp_geoloc_defaut) recevant 3 % des impressions
      ⇒ poids des autres CP identiques à une simulation sans ce CP (amendement E8)
```

---

## 3. Script custom bidding v2 (étape 8)

### 3.1 Paliers par valeur

Bornes fixes sur `poids_v2` (moyenne 1), log-espacées :

```
palier 1 : poids ≥ 2,0
palier 2 : 1,4 ≤ poids < 2,0
palier 3 : 0,8 ≤ poids < 1,4
palier 4 : 0,5 ≤ poids < 0,8
palier 5 : 0 < poids < 0,5
```

Score envoyé pour un palier = **médiane des poids des CP du palier**, arrondie à 2 décimales. Palier vide : omis du script.

### 3.2 Score hors zone

```
zones strictes   : 0
mode national    : 0,8 × min(poids_v2 des CP du plan)
```

Le hors zone est porté par la ligne pseudo-CP `HORS_ZONE` du plan (amendement E3, voir section 5 « Entrées ») : son score est celui ci-dessus, selon le drapeau de mode {strict, national} figé à l'extraction. Les CP réels du plan sont les seuls CP retenus ; `HORS_ZONE` n'entre pas dans `min(poids_v2 des CP du plan)`.

### 3.3 Invariants

```
INV8   un CP dont le poids change sans changer de palier change de score si et seulement si la médiane du palier change (documenter, c'est attendu)
INV9   mode national : tout CP du plan a un score > score hors zone
INV10  script ≤ 2 000 codes postaux par envoi (garde-fou existant conservé), sinon bascule fichier
```

Journaliser à chaque génération : nombre de CP par palier, score par palier, nombre de CP ayant changé de palier depuis la veille.

---

## 4. Dilution dans le plan (étape 1, méthode B)

Dans `lib/zones/plan.ts` (`genererPlanCp`) : ajouter l'option `dilution` (défaut activée) :

```
taux_in(cp)  = population_dans_la_zone(cp) / population_totale(cp)
brut(cp)     = brut(cp) × 0,6     si taux_in(cp) < 0,20
```

appliqué **avant** la normalisation `part = brut / Σ brut`. Une seule fois, à la création du plan. Retirer tout équivalent de `recaler`.

---

## 5. Fichiers à modifier

> **Amendé le 2026-11-04 — le noyau est en Python.** Décision du propriétaire (04/11) : tout l'algorithme d'optimisation est
> en Python. Le noyau vit dans **`services/optimisation/src/optimisation/noyau/`** (module pur : ni base, ni réseau, ni horloge,
> ni hasard — vérifié par `tests/noyau/test_purete.py`), et non dans `lib/optimisation/noyau/`, qui n'a jamais été créé. Les
> fichiers TS ci-dessous se lisent avec cette correspondance : `correction.ts` → `noyau/correction.py`, `paliers.ts` →
> `noyau/paliers.py`, `index.ts` → le paquet `optimisation.noyau`, `types/optimisation.ts` → `noyau/types.py` (dataclasses
> figées) et `types/optimisation.gen.ts` (généré depuis l'OpenAPI du service). `lib/pacing/rebid.ts`, `PacingPanel.tsx` et
> `/api/demo/apply-rebid` ne servent que le React gelé : **non portés**, supprimés au lot 7 (Q2). `lib/simulation/recalage.ts`
> est supprimé à T9, `/simulation/recaler` appelant le service. Pas de `computeRebidWeightsV1` ni de drapeau `REBID_V1` : la
> formule plafonnée n'est pas portée. Les formules (§ 2-4), les invariants et les critères (§ 7) sont inchangés. Plan :
> `docs/superpowers/plans/2026-11-04-optimisation-python-architecture.md` ; architecture : `ARCHITECTURE.md` § « Service
> d'optimisation (Python) ».

La formule de correction vit **à un seul endroit** : `lib/optimisation/noyau/`, module pur (aucun accès base ni réseau, sortie déterministe pour une même entrée). `lib/pacing/rebid.ts` et `lib/simulation/recalage.ts` ne portent plus aucune formule : ils deviennent des réexports du noyau, puis sont supprimés.

| Fichier | Action |
|---------|--------|
| `lib/optimisation/noyau/correction.ts` (créé) | `computeRebidWeightsV2(input): RebidResult` implémentant la section 2. Seule implémentation de la correction dans le dépôt. L'ancienne formule plafonnée y est conservée sous `computeRebidWeightsV1`, derrière le flag `REBID_V1`, pour comparaison ; supprimée après validation. |
| `lib/optimisation/noyau/paliers.ts` (créé) | Section 3.1 et 3.2 : paliers par valeur, score médian par palier, score hors zone. Aucune mise en forme de script. |
| `lib/optimisation/noyau/index.ts` (créé) | Point d'entrée public du noyau : `computeRebidWeightsV2`, `computeRebidWeightsV1`, fonctions de paliers, types `RebidInputV2` / `RebidResult`. |
| `lib/pacing/rebid.ts` | **Étape 1** : réexport de `computeRebidWeights` depuis `lib/optimisation/noyau` (délègue à `computeRebidWeightsV1` sous `REBID_V1`, sinon à V2), aucun code de calcul local. **Étape 2** : supprimé une fois ses appelants (`PacingPanel.tsx`, `/api/demo/apply-rebid`) branchés directement sur le noyau. |
| `lib/simulation/recalage.ts` | **Étape 1** : `recaler` devient un réexport / adaptateur d'interface vers `computeRebidWeightsV2`. Le ×0,6 disparaît (section 4). **Étape 2** : supprimé une fois ses appelants branchés sur le noyau. |
| `lib/simulation/generateur.ts` | Appelle `lib/optimisation/noyau` directement ; aucune formule de correction locale. |
| `lib/zones/plan.ts` | Section 4. |
| `lib/digital/bidding-export.ts` | Section 3 : génère le texte du script à partir de `lib/optimisation/noyau/paliers.ts` ; ne calcule plus lui-même les paliers. |
| `app/api/bidding/strategies/[id]/export` | Exposer le log de paliers (section 3.3). |
| `sql/113_campaign_actors.sql` (`refresh_campaign_rollups`) | Section 6, P2. |
| `sql/280_get_campaign_expected_un_jour.sql` | Section 6, P3. |
| `lib/demo/simulator.ts` | Ajouter le scénario INV5 et un scénario à réponse saturante `s(x) = x / (1 + x)` ; vérifier convergence < 1 point d'écart moyen en ≤ 5 itérations. |

Type d'entrée attendu pour `computeRebidWeightsV2` (défini dans `types/optimisation.ts`, réexporté par `lib/optimisation/noyau/index.ts`) :

```ts
type RebidInputV2 = {
  jours_total: number
  jours_ecoules: number
  impressions_prevues_total: number
  alpha?: number            // défaut 0.8
  k?: number                // défaut 200
  fenetre_max?: number      // défaut 7
  fenetre_min?: number      // défaut 3
  normalisation?: 'non_ponderee'   // défaut ; convention explicite (amendement E4)
  poids_min?: number        // plage du mécanisme (registre) ; défaut 0,001
  poids_max?: number        // plage du mécanisme (registre) ; défaut 999,999
  cps: Array<{
    cp: string
    departement: string     // ou sous-zone
    poids: number
    part_plan: number       // entre 0 et 1, Σ = 1
    livre_cum: number
    livre_fenetre: number
  }>
  mode: 'strict' | 'national'   // figé à l'extraction (amendement E3)
}

type RebidResult = {
  poids: Record<string, number>
  corr_dep: Record<string, number>
  corr_cp: Record<string, number>
  cible_part: Record<string, number>
  obs_part: Record<string, number>
  fenetre_utilisee: number
  moyenne_apres_ecretage: number   // amendement E4
  nb_ecretes: number               // amendement E4
  taux_fuite: number               // obs_part(HORS_ZONE), amendement E8
  cp_neutralises: string[]         // CP de cp_geoloc_defaut, amendement E8
  statut: 'ok' | 'pas_de_correction' | 'plan_atteint'
  raison?: string
}
```

**Entrées : la ligne `HORS_ZONE` (amendement E3).** `cps` contient les CP retenus du plan **et** une ligne pseudo-CP `cp = 'HORS_ZONE'`, sans département (elle ne se rattache à aucun `corr_dep` et suit sa propre correction : `lambda` vaut 1 pour elle, `corr(HORS_ZONE) = corr_cp_brut(HORS_ZONE)`). Son poids est 0 en mode strict (il reste 0 après correction et n'entre pas dans la moyenne), le plancher en mode national (section 3.2). Sa `part_plan` se calcule comme celle des autres lignes, avec pour volume attendu la somme des populations totales des CP peuplés non retenus du référentiel, restreinte à l’univers de la zone, métropole ou France entière (D35, sql/337 ; sa part observée, en mode strict, est le taux de fuite). Toute impression livrée sur un CP absent du plan est imputée à `HORS_ZONE` (`livre_cum`, `livre_fenetre`). Il n'existe qu'une définition du plan, la même que dans le plan de corrections (ticket A1).

---

## 6. Corrections annexes

**P1. Unité du plancher.** Dans `rebid.ts` actuel, vérifier si `part_livrée` est en fraction (0 à 1) ou en pourcentage (0 à 100). Si fraction, `max(part_livrée, 0,001)` écrase les CP (part typique 0,0008) et biaise le facteur à ≈ 0,85 pour un CP correctement livré. La v2 utilise `eps = 1e-6` sur des fractions : s'assurer que toutes les parts entrent en fraction.

**P2. CP du plan jamais servis.** `refresh_campaign_rollups` : construire le rollup par CP depuis le plan (`plan LEFT JOIN livraison`), `0` pour les CP non servis. Ces CP doivent apparaître dans les mesures d'écart, le score, les alertes « CP sous le plan » et l'entrée du rebid.

**P3. Pacing, jour courant.** `get_campaign_expected` : `t = jours_livrés / N`, où `jours_livrés` = nombre de jours dont la livraison est effectivement disponible (dernière date du rollup quotidien), pas `date_du_jour − début + 1`. Supprime le biais de 1/N vers « en retard ».

**P4. Univers des CP (méthode A).** Évaluer la courbe de pression sur le référentiel complet des codes postaux, pas sur les CP déjà vus en livraison. Univers nommés (amendement E10) : référentiel 6 187 CP (score, noyau) ; peuplés 6 009 CP (plan) ; métropole peuplés 5 956 CP (couverture) ; livrés Adform 6 030 CP (seule campagne réelle).

**P5. Seuils réglables.** Sortir 0,85 / 1,15 / 1,25 / 70 % / 5 % / ±20 % / alpha / k / bornes de paliers / convention de normalisation (moyenne non pondérée, amendement E4) / seuil d'alerte du taux de fuite (amendement E8) dans une table `campaign_settings` (ou JSON par campagne) avec les valeurs actuelles comme défaut.

---

## 7. Critères d'acceptation

1. Tous les invariants INV1 à INV10 couverts par des tests unitaires qui passent.
2. Sur la campagne « Démo pilotage, élections » au 30/04 : le rebid v2 produit des corrections département dans l'ordre 13 > 59 > 1 > 75 ≈ 29, et aucun CP ne reçoit `corr` hors de [0,415, 2,408].
3. Simulateur réponse proportionnelle : écart moyen en points < 0,5 après 3 itérations. Simulateur saturant : < 1 point après 5 itérations. Aucune oscillation (l'écart moyen décroît strictement).
4. Sur 20 itérations avec livraison exactement conforme à `cible_jour` : poids stables à 1e-6 (pas de windup).
5. Le script custom bidding généré loge les paliers et respecte INV9 et INV10.
6. `grep -rn "0\.6" lib/optimisation lib/pacing lib/simulation` ne renvoie aucun coefficient de dilution (les deux derniers dossiers s'ils existent encore). Le seul 0,6 autorisé est dans `lib/zones/plan.ts` (dilution du plan, section 4), et il doit être une constante nommée, par exemple `COEF_DILUTION`, pas un littéral.
7. Le `.docx` de référence est mis à jour : chapitre 10 (formule v2 unique), chapitre 11 (paliers par valeur, hors zone), chapitre 15 (retirer les limites 4 et 5, ajouter « élasticité réelle à mesurer sur pilote »).

---

## 8. Hors périmètre

- Boucle de correction du volume global (budget, enchère de base) : à formaliser séparément.
- Courbe de pacing non linéaire (jour de semaine).
- Connecteurs API DV360 / TTD / Meta / TikTok et ordonnanceur Inngest.
