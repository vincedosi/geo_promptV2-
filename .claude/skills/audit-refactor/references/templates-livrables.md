# Templates des livrables

## Sommaire
1. docs/ARCHITECTURE.md
2. docs/AUDIT.md
3. docs/REFACTOR_PLAN.md
4. docs/REFACTOR_REPORT.md

---

## 1. docs/ARCHITECTURE.md

```markdown
# Architecture

## Vue d'ensemble
[3 à 5 phrases : ce que fait l'application, pour qui, comment elle est découpée]

## Stack
| Couche | Technologie | Version |
|---|---|---|

## Points d'entrée
| Type | Fichier | Rôle |
|---|---|---|

## Composants
[Diagramme Mermaid graph TD : modules et dépendances réelles]

## Flux de données
### Flux 1 : [nom]
[Diagramme Mermaid sequenceDiagram]
[Étapes clés avec fichier:ligne]

## Configuration et environnement
| Variable | Usage | Obligatoire |
|---|---|---|

## Écarts constatés
[Écarts entre l'architecture apparente (noms de dossiers, doc) et l'architecture réelle]
```

## 2. docs/AUDIT.md

```markdown
# Audit

## Synthèse
| Gravité | Nombre |
|---|---|
| Critique | |
| Haute | |
| Moyenne | |
| Basse | |

## Top 5 des zones critiques
[Une ligne par zone, avec renvoi aux identifiants]

## Constats

### A-001 [Catégorie] Titre court
- **Localisation** : `fichier:ligne`
- **Constat** : description factuelle
- **Impact** : conséquence concrète
- **Gravité** : critique | haute | moyenne | basse
- **Effort** : S | M | L
```

Préfixes d'identifiant : ARC (architecture), DUP (duplication), PERF (goulots), ECH (échelle), MAINT (maintenabilité), SEC (sécurité).

## 3. docs/REFACTOR_PLAN.md

```markdown
# Plan de refactor

## Ordre d'exécution
| Lot | Objectif | Constats traités | Risque | Effort |
|---|---|---|---|---|

## Lot 0 : filet de sécurité
- Flux couverts par les tests de caractérisation :
- Baseline à capturer :

## Lot N : [titre]
- **Objectif** :
- **Constats traités** :
- **Fichiers touchés** :
- **Risque** :
- **Vérification du comportement identique** :

## Hors périmètre (à arbitrer)
| Point | Pourquoi c'est un changement de comportement | Gravité | Recommandation |
|---|---|---|---|
```

## 4. docs/REFACTOR_REPORT.md

```markdown
# Rapport de refactor

## Résumé
[3 phrases : ce qui a été fait, état final, risques restants]

## Lots réalisés
| Lot | Commits | Statut |
|---|---|---|

## Métriques avant / après
| Mesure | Avant | Après |
|---|---|---|
| Taille max de fichier | | |
| Blocs dupliqués | | |
| Couverture de tests | | |
| Warnings lint | | |
| Erreurs typecheck | | |
| `any` et casts forcés | | |

## Lots non traités
| Lot | Raison |
|---|---|

## Bugs métier détectés, non corrigés
| Localisation | Description | Gravité |
|---|---|---|

## Risques résiduels et prochaines étapes
```
