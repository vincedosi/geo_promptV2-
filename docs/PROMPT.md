Lis DESIGN_SYSTEM.md, .claude/skills/geomatik-ux/SKILL.md et .claude/skills/geomatik-product-vision/SKILL.md.

## CONTEXTE
Sprint 2 (Digital intégré) est livré mais il y a 5 bugs critiques à fixer.

## BUG 1 — Cartes noires (fond noir sans tuiles)
Les 3 cartes de la vue comparée ont un fond noir — les tuiles MapLibre 
ne se chargent pas. Probable cause : le style URL n'est pas passé 
aux instances MapLibre dans TripleMapView.tsx.

Diagnostic :
```bash
grep -rn "style\|mapStyle\|setStyle\|cartocdn\|positron\|dark-matter" --include="*.tsx" --include="*.ts" components/digital/ app/map/
```
Vérifier que TripleMapView.tsx reçoit et applique le même style de carte 
que la carte principale. Comparer avec l'ancienne page /map/analyse/digital/ 
qui fonctionnait — le style y était passé comment ?

## BUG 2 — Cartes qui clignotent
Les cartes clignotent quand on affiche une campagne. 
Probable cause : re-render en boucle — un state qui change 
déclenche un re-fetch qui change le state qui re-render.

Diagnostic :
- Ajouter un console.log temporaire dans le useEffect qui charge les données
- Vérifier les deps du useEffect — y a-t-il un objet non-mémoïsé dans les deps ?
- Vérifier que use-digital-data.ts ne refetch pas en boucle
- Utilise systematic-debugging pour isoler le cycle

## BUG 3 — Pas de sélecteur de cible (tranche d'âge)
Dans la section Campagnes Média du panel, il manque le select de cible.
L'ancienne page Digital avait un select pour choisir la tranche d'âge 
(15-29 ans, 25-49 ans, Ensemble, etc.).

Diagnostic :
```bash
grep -rn "cible\|target\|tranche\|age_range\|ageRange" --include="*.tsx" app/map/analyse/digital/
```
Le composant existe dans l'ancienne page. Il faut l'intégrer dans la 
section Campagnes Média du FilterPanel, APRÈS le select campagne.
Les options viennent de DISTINCT sur les données de la campagne sélectionnée.

## BUG 4 — Impressions pas affichées sur les cartes
Les choroplèthes ne colorent pas les régions — les données ne sont pas 
passées aux cartes. Vérifier la chaîne complète :
1. use-digital-data.ts fetch les données
2. Les données sont passées à TripleMapView.tsx
3. TripleMapView applique les sources/layers GeoJSON sur chaque carte

Comparer avec l'ancienne page qui fonctionnait :
```bash
diff <(grep -n "source\|addSource\|addLayer\|setData\|geojson" app/map/analyse/digital/_components/SyncMap.tsx) <(grep -n "source\|addSource\|addLayer" components/digital/TripleMapView.tsx)
```

## BUG 5 — Bouton toggle thème manquant
Le ThemeToggle.tsx existe (Sprint 0) mais il n'est pas visible dans le header.
Vérifier :
```bash
grep -rn "ThemeToggle\|theme-toggle\|themeToggle" --include="*.tsx" app/layout.tsx components/
```
S'assurer qu'il est importé et rendu dans le header, à côté du sélecteur 
d'organisation.

## ORDRE DE CORRECTION
1. D'abord le fond de carte noir (sans ça on voit rien)
2. Puis les données/impressions (sans ça les cartes sont vides)
3. Puis le sélecteur de cible (sans ça on peut pas filtrer)
4. Puis le clignotement (UX)
5. Puis le bouton thème (cosmétique)

## MÉTHODE
Pour chaque bug :
1. Diagnostic avec les commandes grep ci-dessus
2. Comparer avec l'ancienne page /map/analyse/digital/ QUI FONCTIONNAIT
3. Le fix doit rétablir le même comportement, pas réinventer
4. Commit séparé par bug : fix(digital): [description]

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
1. Lance @cleanup-geomatik Partie 2 + 3 sur les fichiers modifiés
2. npm run build — 0 erreurs
3. Commit : chore(cleanup): post-fix digital bugs

## INTERDIT
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS réécrire TripleMapView ou SyncMap from scratch — fixer, pas refaire