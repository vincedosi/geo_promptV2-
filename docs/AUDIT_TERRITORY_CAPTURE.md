# AUDIT — Système filtre territoire + mask + capture

_Consolidation de 3 audits parallèles (FilterPanel chain, CustomGeoCapture, API↔RPC). Chemin original demandé `/mnt/user-data/outputs/` remplacé par `docs/` (Windows)._

**Status** : 🛑 **AUDIT COMPLET — EN ATTENTE DE VALIDATION AVANT TOUT CODE.**

---

## 🔴 Bugs critiques (bloquants)

### #1 — Codes régions/départements désynchronisés entre front et RPC
**Fichiers** : `lib/geo/france-admin.ts:9-62` + `app/map/_components/FilterPanel.tsx:994-996`

**Preuve code** (FilterPanel.tsx:994) :
```tsx
adminFetch('/api/map/territory-mask', {
  method: 'POST',
  body: JSON.stringify({ scale: adminScale, codes: adminCodes }),
})
```

`adminCodes` est rempli par `selectedRegions` qui contient des codes **alphabétiques applicatifs** :
```tsx
// lib/geo/france-admin.ts:9
REGIONS_ADMIN: [
  { id: 'ara', nom: 'Auvergne-Rhône-Alpes', depts: [...] },
  { id: 'bre', nom: 'Bretagne', depts: [...] },
  { id: 'idf', nom: 'Île-de-France', depts: [...] },
  ...
]
```

Mais la RPC `get_territory_mask_geometry` attend des **codes INSEE numériques officiels** :
- `'11'` = Île-de-France, `'53'` = Bretagne, `'84'` = Auvergne-Rhône-Alpes
- Validé par l'exemple du PROMPT : `get_territory_mask_geometry('region', ['53']) → MultiPolygon Bretagne OK`

**Effet** : quand l'user sélectionne Bretagne → front envoie `['bre']` → RPC ne matche aucune région → retourne `geometry: null` → `applyMask(geom)` n'est jamais appelé (FilterPanel.tsx:1001-1003) → **ni le toggle ni le mask ne s'affichent**.

**Pour les départements** : les codes sont les mêmes côté front et INSEE (`'35'`, `'75'`, `'2A'`, etc.) — c'est pour ça qu'ils fonctionnent "partiellement" (l'exception Corse `'2A'/'20A'` est déjà un autre bug traité antérieurement via `expandDeptCodes`).

**Criticité** : ✗ Bloque totalement le filtre région.

---

### #2 — Bouton "Sauvegarder" grisé : `resolving` qui ne revient jamais à `false`
**Fichier** : `components/custom-geo/CustomGeoCaptureModal.tsx:80-132`

**Preuve code** (CustomGeoCaptureModal.tsx:132) :
```tsx
const canSubmit = !!name.trim() && hasData && !!orgId
                  && !saving && !success && !resolving;
```

À l'ouverture de la modal (ligne 85-101) : `Promise.all()` lance tous les `getGeometry()` des layers contributifs via `useCustomGeoLayer.ts`. Si **UN seul** layer a un `getGeometry()` qui :
- Rejette silencieusement dans un try/catch sans `reject()` propre (ex: `CaptureLayers.tsx:188-199` — `getCarreauxGeom` peut fetch et retourner `null` sans erreur)
- Ou pend indéfiniment (promise jamais résolue, ex: layer sans `getGeometry` défini)

→ `Promise.all()` ne settle jamais → `setResolving(false)` jamais appelé → `canSubmit = false` en permanence → **bouton grisé même nom+layers valides**.

**Criticité** : ✗ Bloque totalement le flux de capture.

---

### #3 — Carreaux Filosofi débordent du mask territorial
**Fichier** : `components/CarreauxPMTilesLayer.tsx:231-241` + `components/CarreauxPMTilesLayer.tsx:249-260`

**Preuve code** (ligne 231) :
```tsx
map.addLayer({
  id: FILL_ID,
  type: 'fill',
  source: SOURCE_ID,
  'source-layer': SOURCE_LAYER,
  minzoom: 6,
  paint: { /* ... */ },
  layout: { visibility: visibleRef.current ? 'visible' : 'none' },
  // ❌ Aucun filter appliqué
});
```

**Mismatch** : la **modal de capture** utilise bien `admin_scope` via `/api/custom-geo/source/carreaux` (scopé côté RPC ✓). Mais le **layer MVT visuel** sur la carte (`carreaux-mvt-fill`) n'applique **aucun `map.setFilter()`** dépendant de `adminScope`. Résultat : les carreaux affichés sur la carte sont toujours nationaux, alors que ceux capturés sont scopés → divergence données rendues vs données capturées.

**Pattern correct existant sur IRIS** (`app/copilote/_hooks/useMapLayers.ts:456-466`) :
```tsx
const filter = irisTrueOnly
  ? ['==', ['get', 'is_true_iris'], true] : null;
map.setFilter('iris-fill',   filter);
map.setFilter('iris-border', filter);
```

Ce pattern **manque** pour carreaux.

**Criticité** : ✗ Data integrity — l'user capture ce qu'il ne voit pas, ou voit ce qu'il ne capture pas.

---

## 🟡 Bugs moyens

### #4 — Sections "Régions" / "Départements" fermées par défaut en mode overlay
**Fichier** : `app/map/_components/FilterPanel.tsx:628-637`

**Preuve code** :
```tsx
const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() => {
  if (isOverlayMode) return Object.fromEntries(SECTION_KEYS.map(k => [k, false]));
  // ...
});
```

En mode overlay (Périmètre overlay), tous les accordéons sont fermés. L'user doit cliquer sur "Régions" pour déplier la liste. Peut donner l'impression que "rien ne se passe" si couplé au bug #1 (le user clique le dropdown, sélectionne Bretagne, rien ne change sur la carte car codes mismatch).

**Criticité** : UX mineur. Fix trivial : forcer `perimetre`, `regions`, `departements` à true en mode overlay.

---

### #5 — `AdminScope` accepte `'ville'` mais FilterPanel ne le définit jamais
**Fichiers** : `lib/custom-geo/CustomGeoCaptureContext.tsx:16` + `app/map/_components/FilterPanel.tsx:850-852`

FilterPanel calcule `adminScale` ainsi :
```tsx
const adminScale = selectedDepts.length > 0 ? 'departement' :
                   selectedRegions.length > 0 ? 'region' : null;
```

La recherche ville/code postal (lignes 1774-1779) existe mais n'alimente jamais `adminScale`. `AdminScopeSchema` côté backend accepte pourtant `scale='ville'`. Donc les recherches locales (ex: "Bordeaux") ne déclenchent pas le scope de capture.

**Criticité** : Feature incomplète, pas un bug bloquant.

---

## 🟠 Bug mineur / edge case

### #6 — `orgId` vide si `user_metadata.organization_id` absent
**Fichiers** : `components/custom-geo/CustomGeoCaptureModal.tsx:66` + `lib/auth-client.ts:53,77`

```tsx
const orgId = session?.user?.organizationId ?? '';  // modal.ts:66
// auth-client.ts:53
organizationId: u.user_metadata?.organization_id ?? null,
```

Si un user (ex: super_admin en "mode toutes organisations") n'a pas de `organization_id` dans `user_metadata`, `orgId = ''` → `!!orgId = false` → `canSubmit = false` → bouton grisé silencieusement.

**Criticité** : Edge case (contourné quand un admin switch vers une org spécifique via SessionBadge).

---

## ✅ Non-bugs (ce qui fonctionne)

1. **État lifté à `page.tsx`** : `perimeterSelectedRegions/Depts/scope/ville` sont correctement liftés depuis les useState locaux (refactor récent appliqué par lift-state). Survit aux cycles mount/unmount d'overlay.
2. **CustomGeoCaptureContext — propagation du scope** : `useEffect` dans FilterPanel (lignes 865-876) appelle correctement `setActiveScope({ scale, codes })` dès que `adminScale`/`adminCodes` changent.
3. **Cohérence API ↔ RPC** : audit exhaustif des 10 routes `/api/custom-geo/source/*` + `/api/map/territory-mask` → **aucun mismatch** de noms/types/transformations entre frontend → API → args RPC (`p_scale`, `p_codes`, `p_bbox_*`, `p_admin_scope`, etc. correctement propagés).
4. **CaptureLayers — registre de layers contributifs** : pattern propre avec refs stables, pas de re-render en cascade, enregistrement conditionnel correct.
5. **Extraction orgId session** : `session?.user?.organizationId` est la bonne source depuis `u.user_metadata.organization_id` (pas de mismatch `session.org_id` résiduel — le bug historique d'avril a été corrigé).

---

## 🛠️ Fixes recommandés (ordre de criticité)

| # | Bug | Fichier/Ligne | Effort | Criticité |
|---|---|---|---|---|
| **1** | Codes région alphabétiques vs INSEE numériques | `lib/geo/france-admin.ts` — ajouter un champ `code_insee` sur chaque `Region`, utiliser `code_insee` pour `adminCodes` au lieu de `id` | S (20 lignes) | ✗ URGENT |
| **2** | `resolving` qui ne settle jamais | `components/custom-geo/CustomGeoCaptureModal.tsx:85-101` — wrap `Promise.all` dans `Promise.race` avec timeout 10s + logger les layers qui ont failed | S | ✗ URGENT |
| **3** | Pas de `setFilter` dynamique sur carreaux | `components/CarreauxPMTilesLayer.tsx` — ajouter un `useEffect` qui appelle `map.setFilter('carreaux-mvt-fill', filter)` avec une expression MapLibre basée sur `adminScope.codes` (pattern copié-adapté de `iris-fill`) | M (30 lignes) | ✗ URGENT |
| **4** | Sections overlay fermées | `app/map/_components/FilterPanel.tsx:628-637` — dans la branche `isOverlayMode`, forcer `regions: true, departements: true, perimetre: true` | XS | 🟡 |
| **5** | `AdminScope ville` non utilisé | FilterPanel lignes 850-852 — étendre le calcul d'`adminScale` pour inclure le cas `ville` quand un code postal ou nom de ville est rempli | M | 🟡 |
| **6** | `orgId` vide bloque silencieusement | `CustomGeoCaptureModal.tsx:66+132` — si `!orgId`, afficher un message "Organisation non configurée — contactez votre admin" au lieu de griser sans raison | S | 🟠 |

---

## ❓ Questions ouvertes avant fix

1. **Format exact des codes région attendu par la RPC** : est-ce le code INSEE officiel à 2 chiffres (`'11'` pour IDF, `'53'` pour Bretagne) ou un autre système ? → **Validation à faire via un test rapide de la RPC** avec les codes candidats, ou lecture du DEF de `get_territory_mask_geometry` côté Supabase.
2. **Table `ref_regions`** : quelle colonne sert de clé de matching (`code_region`, `code_insee`, `id`) ? La RPC fait probablement `WHERE code_region = ANY($1)` — il faut confirmer le nom de colonne.
3. **Timeout pour Promise.all dans la modal** : 10s est-il raisonnable ? Si oui, OK. Sinon, instrumenter pour identifier le layer le plus lent.
4. **Comportement attendu quand un layer échoue** : aujourd'hui `failedCollected` récupère les erreurs (modal.ts:110-112) mais ne les affiche pas proactivement. UX à définir — toast ? warning inline ?
5. **Scope `'ville'` — intention produit ?** : la recherche locale (`ville`, `codePostal`) devrait-elle réellement participer au scope de capture ? À clarifier avec le PO avant de cabler.

---

## 🚧 Prochaines étapes (en attente de validation)

Si le rapport est validé, l'ordre d'implémentation proposé est :

1. **Fix #1** (codes INSEE) — un seul fichier, effet immédiat, débloque les 4 bugs user
2. **Fix #2** (timeout resolving) — isole le bouton Sauvegarder
3. **Fix #3** (setFilter carreaux) — cohérence visuelle capture
4. Validation user (recharge + test Bretagne + capture + voir carreaux masqués)
5. Fix #4, #5, #6 en lot cleanup

🛑 **STOP. En attente de ta validation avant toute ligne de code.**
