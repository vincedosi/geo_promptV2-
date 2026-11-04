# Optimisation en Python — phase 2, corrections de données (tâches 2.1 à 2.4) : effet mesuré

05/11/2026. Branche `feat/optimisation-python`. Rien n'est poussé. **Rien ne change tant que personne ne règle une
campagne** : les trois corrections sont derrière des réglages par campagne (`optimisation_reglages`, sql/345) dont la
valeur par défaut est le comportement d'avant.

## En une phrase

Les codes postaux du plan jamais servis apparaissent désormais dans les tableaux, le score et les alertes ; la méthode A
part du référentiel complet ; les seuils d'alerte sont réglables. **Sur la démo, la première correction ne change
rien : ses 1 641 codes du plan sont tous servis.** Elle est prouvée sur des cas construits et sur deux campagnes réelles
sans livraison.

## 2.1 — tableaux par code postal depuis le plan

Avant : `campaign_cp_rollup` partait de la livraison. Un code du plan jamais servi n'avait aucune ligne : son manque
n'entrait ni dans le score ni dans l'alerte « CP cibles sous 70 % du plan ». Après (réglage `tableaux_depuis_plan`) :
une ligne à 0 par code du plan jamais servi ; les codes livrés hors plan restent.

| Campagne | Codes du plan | Jamais servis (ajoutés) | Effet sur les mesures |
|---|---|---|---|
| Démo « élections » | 1 641 | **0** | aucun : score 93 et 161 CP sous 70 %, inchangés |
| Campagne `d0000000-…f1a5` (jeu de zones, livrée) | 1 942 | 0 | aucun (score 86) |
| Campagne `4935811d-…` (jeu de zones, sans livraison) | 88 | **88** | lignes visibles ; score et suivi restent « aucune donnée » (rien n'a été livré) |
| Campagne `ba49acd8-…` (jeu de zones, sans livraison) | 88 | **88** | idem |

Le « 176 » du plan de la phase 0 : la campagne `4935811d` porte deux stratégies de 88 lignes. Seule la plus récente
compte (comme partout dans le suivi), d'où 88 + 88 sur les deux campagnes.

**Cas construits** (fixture partagée Python / SQL, quatre cas, deux codes non servis chacun) :

| Cas | Avant | Après |
|---|---|---|
| Strict, 4 codes au plan dont 2 servis | score 61, « 1 CP cibles sous 70 % » | score **17**, « **3** CP cibles sous 70 % » |
| National (codes à multiplicateur 1 hors cible) | 1 ligne | 3 lignes (part du plan conservée, hors cible) |
| Part prévue, dont une à NULL (population inconnue) | 1 ligne | 3 lignes (la part NULL reste NULL) |
| Sans aucune livraison | 0 ligne | 2 lignes |

Python et SQL rendent exactement les mêmes lignes (au texte près) sur les quatre cas.

## 2.2 — méthode A sur le référentiel complet

Réglage `univers_methode_a` : `fige` (défaut, lecture de la phase 1) ou `referentiel`.

| Univers | Codes | Multiplicateurs > 0 |
|---|---|---|
| Figé (plan écrit de la démo) | 11 435 | 1 641 |
| Ce que le SQL lirait aujourd'hui (`DISTINCT dsp_campaign_data`) | 11 415, dont 6 167 du référentiel | — |
| **Référentiel** (`ref_codes_postaux`) | **6 187** | **1 641** |

- Sur les 6 187 codes communs, multiplicateurs **identiques** à l'univers figé.
- **−5 248** codes étrangers (`00-001`, `?`…), tous à 0 : ils sortent.
- **+20** codes du référentiel jamais livrés nulle part, que le SQL d'aujourd'hui perdrait. Tous à 0 pour la démo (hors
  zone). Liste : 05480, 09390, 17123, 20141, 20153, 20164, 20173, 20275, 22870, 29253, 29259, 29990, 97128, 97136,
  97137, 97140, 97316, 97319, 97625, 97680.

## 2.3 — seuils réglables

`get_campaign_suivi` et le service lisent rythme (0,85 / 0,70 / 1,15 / 1,30), CPM (× 1,25), CP sous le plan (70 %) et
fuite (5 %) dans les réglages ; ± 20 % des constats est stocké mais lu par personne (calcul TS, React gelé).

- Sans réglage : sortie de `get_campaign_suivi` **identique au md5 près** sur les 11 campagnes locales, avec et sans
  filtre d'acteur.
- Sous 8 réglages : Python = SQL au texte près. Exemple démo : CP sous 50 % et retard à 0,5 → « 52 CP cibles sous 50 %
  du plan », plus d'alerte de rythme.

## Coût en base (EXPLAIN ANALYZE, local)

| Lecture neuve | Mesure |
|---|---|
| Réglages d'une campagne | 4 tampons, 0,9 ms (parcours de `dsp_campaigns`, 11 lignes ; clé primaire des réglages) |
| Référentiel des codes postaux | index seul, 19 tampons, 3 ms |
| Codes non servis (seconde insertion, démo) | 10 128 tampons en cache, 22,7 ms ; rafraîchissement complet 0,58 s (`true`) contre 0,66 s (`false`) |

## Ce qui reste ouvert

1. **Aucune campagne n'est réglée** : la base a 0 ligne de réglages. Les corrections s'activent campagne par campagne,
   par le service (écriture de la tâche 2.7) ou à la main en local.
2. **`dsp_campaigns` est illisible par tout compte connecté** (42P17, récursion entre deux policies existantes), mesuré
   au passage. Sans effet sur l'application (clé `service_role`). Non corrigé : hors de ces tâches.
3. La fonction SQL de la méthode A (`apply_zone_weights_to_strategy`) lit toujours `DISTINCT dsp_campaign_data`. Elle
   reste jusqu'à la bascule.
