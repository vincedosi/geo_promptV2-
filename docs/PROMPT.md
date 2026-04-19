# GEOMATIK — Custom Geo Zones / Étape 1 : Fondations génériques (FINAL)

> Réfère-toi à `CLAUDE.md` et `DESIGN_SYSTEM.md` à la racine avant de commencer.

## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design @geomatik-metier @supabase-geomatik

---

## CONTEXTE

GEOMATIK introduit un **système générique de capture de zones géographiques**. Tout module de la plateforme qui produit une géométrie sur la carte (zone de couverture radio, prévision météo, sélection d'IRIS ciblés, isochrones, carreaux Filosofi sélectionnés, dessin libre, Voronoï, couverture audience, POI + buffer…) doit pouvoir **sauvegarder cette géométrie comme "zone custom"** réutilisable.

Une zone custom, une fois sauvegardée :
1. Est persistée en base avec sa géométrie brute + métadonnées
2. Est automatiquement **résolue en liste d'IRIS et de codes postaux** (via `ST_Intersects` — tout ce qui touche est inclus, pas de seuil de recouvrement)
3. Devient réutilisable dans `/map/analyse/digital` comme zone activable pour le ciblage DSP
4. Est exportable en CSV (codes postaux, IRIS) ou GeoJSON pour les DSP externes

**Cette étape (Étape 1) construit uniquement les fondations techniques.** Les étapes suivantes (galerie `/map/custom-geo`, back-office, intégration digital, branchement des modules sources) sont hors scope de ce prompt.

---

## CONTRAINTE CRITIQUE : GÉNÉRICITÉ

Le système ne doit connaître **aucun module source spécifique**. Pas de `if source === 'radio'`, pas de traitement particulier pour la météo. Il reçoit :
- Une géométrie GeoJSON (Polygon ou MultiPolygon)
- Un `source_type` en string libre (`radio_coverage`, `meteo_forecast`, `iris_selection`, `isochrone`, `manual_draw`, `carreaux_selection`, etc. — **jamais hardcodé en enum, accepté tel quel**)
- Un `metadata` JSON libre

Et produit :
- Une zone persistée
- Sa liste d'IRIS + CP dérivée

Point.

---

## VALEURS CONFIRMÉES (Phase 0 déjà faite)

| Élément | Valeur |
|---|---|
| `organizations.id` | `uuid` |
| Table IRIS | `public.iris` |
| IRIS code | `code_iris` (text) |
| IRIS geom | `geom` |
| IRIS count | 49 363 |
| Table CP | `public.ref_codes_postaux` |
| CP code | `code_postal` (text) |
| CP geom | `geom` |
| CP count | 6 187 |
| Membership | `organization_members (user_id uuid, organization_id uuid)` |
| RLS helper | `get_user_org()` (+ `get_user_role()`) |
| API auth | `requireAuth(request) → UserProfile` dans `lib/api/middleware.ts` |
| Table custom existante | Aucune — on part from scratch |

---

## PHASE 0.6 — DÉCISION MULTI-ORG (à faire AVANT la migration)

On doit déterminer si `get_user_org()` suffit pour les policies, ou s'il faut une sous-requête sur `organization_members`.

### Étape 1 : inspecter la fonction

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'get_user_org';
```

### Étape 2 : vérifier s'il existe des users multi-org en pratique

```sql
SELECT user_id, COUNT(*) AS nb_orgs
FROM public.organization_members
GROUP BY user_id
HAVING COUNT(*) > 1
LIMIT 5;
```

### Étape 3 : décision

- **Si `get_user_org()` retourne UN uuid (cas mono-org)** ET **zéro ligne en Étape 2** → utiliser `org_id = get_user_org()` dans toutes les policies (cohérent avec `dsp_campaigns`)
- **Si multi-org est possible** (plusieurs lignes par user en Étape 2, ou la fonction retourne plusieurs valeurs) → utiliser `org_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())`

**Documente ta décision** dans le commit et dans un commentaire SQL en tête de migration. Continue avec le pattern retenu.

---

## PHASE 1 — MIGRATION SQL

Fichier : `supabase/migrations/YYYYMMDDHHMMSS_custom_geo_zones.sql`

```sql
-- ============================================================
-- GEOMATIK — Custom Geo Zones (système générique)
-- Décision RLS : <mono-org OU multi-org, selon Phase 0.6>
-- ============================================================

-- Table principale
CREATE TABLE IF NOT EXISTS public.custom_geo_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type     text NOT NULL,          -- string libre : radio_coverage, meteo_forecast, iris_selection, ...
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry        geometry(MultiPolygon, 4326) NOT NULL,
  bbox            geometry(Polygon, 4326),
  feature_count_iris integer NOT NULL DEFAULT 0,
  feature_count_cp   integer NOT NULL DEFAULT 0,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_geo_zones_org   ON public.custom_geo_zones (org_id);
CREATE INDEX IF NOT EXISTS idx_custom_geo_zones_user  ON public.custom_geo_zones (created_by);
CREATE INDEX IF NOT EXISTS idx_custom_geo_zones_type  ON public.custom_geo_zones (source_type);
CREATE INDEX IF NOT EXISTS idx_custom_geo_zones_geom  ON public.custom_geo_zones USING GIST (geometry);

-- Trigger : bbox + updated_at + normalisation MultiPolygon
CREATE OR REPLACE FUNCTION public.custom_geo_zones_before_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF GeometryType(NEW.geometry) = 'POLYGON' THEN
    NEW.geometry := ST_Multi(NEW.geometry);
  END IF;
  NEW.bbox := ST_Envelope(NEW.geometry);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_custom_geo_zones_before_write ON public.custom_geo_zones;
CREATE TRIGGER trg_custom_geo_zones_before_write
  BEFORE INSERT OR UPDATE ON public.custom_geo_zones
  FOR EACH ROW EXECUTE FUNCTION public.custom_geo_zones_before_write();

-- Table des codes résolus
CREATE TABLE IF NOT EXISTS public.custom_geo_zone_codes (
  zone_id     uuid NOT NULL REFERENCES public.custom_geo_zones(id) ON DELETE CASCADE,
  code_type   text NOT NULL CHECK (code_type IN ('iris', 'cp')),
  code        text NOT NULL,
  PRIMARY KEY (zone_id, code_type, code)
);

CREATE INDEX IF NOT EXISTS idx_custom_geo_zone_codes_lookup
  ON public.custom_geo_zone_codes (zone_id, code_type);

-- ============================================================
-- RLS — utiliser le pattern retenu en Phase 0.6
-- ============================================================

ALTER TABLE public.custom_geo_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_geo_zone_codes ENABLE ROW LEVEL SECURITY;

-- VARIANTE A (mono-org, cohérent avec dsp_campaigns) :
CREATE POLICY custom_geo_zones_select_by_org
ON public.custom_geo_zones FOR SELECT
USING (org_id = get_user_org());

CREATE POLICY custom_geo_zones_insert_by_user
ON public.custom_geo_zones FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND org_id = get_user_org()
);

CREATE POLICY custom_geo_zones_update_by_creator
ON public.custom_geo_zones FOR UPDATE
USING (created_by = auth.uid() AND org_id = get_user_org());

CREATE POLICY custom_geo_zones_delete_by_creator
ON public.custom_geo_zones FOR DELETE
USING (created_by = auth.uid() AND org_id = get_user_org());

CREATE POLICY custom_geo_zone_codes_select
ON public.custom_geo_zone_codes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.custom_geo_zones z
    WHERE z.id = zone_id AND z.org_id = get_user_org()
  )
);

-- VARIANTE B (multi-org) — si Phase 0.6 confirme ce pattern :
-- Remplacer `org_id = get_user_org()` par :
--   org_id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
-- sur CHAQUE policy.
```

Applique via MCP Supabase : `apply_migration`. Puis vérifie :

```sql
SELECT tablename FROM pg_tables WHERE tablename LIKE 'custom_geo%';
SELECT polname, tablename FROM pg_policies WHERE tablename LIKE 'custom_geo%';
```

---

## PHASE 2 — RPC MÉTIER

Deux RPC dans la même migration ou séparée :

### 2.1 — `create_custom_geo_zone` (insertion safe)

```sql
CREATE OR REPLACE FUNCTION public.create_custom_geo_zone(
  p_name text,
  p_description text,
  p_org_id uuid,
  p_source_type text,
  p_source_metadata jsonb,
  p_geometry_geojson text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER                    -- RLS s'applique à l'insertion
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_geom geometry;
BEGIN
  -- Parse + validation géométrie
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson), 4326);

  IF GeometryType(v_geom) NOT IN ('POLYGON', 'MULTIPOLYGON') THEN
    RAISE EXCEPTION 'Geometry must be Polygon or MultiPolygon, got %', GeometryType(v_geom);
  END IF;

  IF NOT ST_IsValid(v_geom) THEN
    v_geom := ST_MakeValid(v_geom);
  END IF;

  INSERT INTO public.custom_geo_zones (
    name, description, org_id, created_by, source_type, source_metadata, geometry
  ) VALUES (
    p_name, p_description, p_org_id, auth.uid(), p_source_type, p_source_metadata, ST_Multi(v_geom)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_custom_geo_zone(text, text, uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_custom_geo_zone(text, text, uuid, text, jsonb, text) TO authenticated;
```

### 2.2 — `resolve_custom_geo_zone_codes` (intersection IRIS + CP)

```sql
CREATE OR REPLACE FUNCTION public.resolve_custom_geo_zone_codes(p_zone_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER                    -- nécessaire pour écrire dans custom_geo_zone_codes
SET search_path = public
AS $$
DECLARE
  v_zone_geom geometry;
  v_org_id    uuid;
  v_count_iris integer;
  v_count_cp integer;
BEGIN
  -- Lire la zone + son org (pour vérifier accès de l'appelant)
  SELECT geometry, org_id INTO v_zone_geom, v_org_id
  FROM public.custom_geo_zones
  WHERE id = p_zone_id;

  IF v_zone_geom IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  -- Vérif auth : l'appelant doit être dans le workspace de la zone
  -- (get_user_org() retourne l'org courante ; on autorise aussi multi-org si la fonction le gère)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  -- Purge anciens codes
  DELETE FROM public.custom_geo_zone_codes WHERE zone_id = p_zone_id;

  -- IRIS
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'iris', i.code_iris
  FROM public.iris i
  WHERE i.geom IS NOT NULL
    AND ST_Intersects(i.geom, v_zone_geom);

  GET DIAGNOSTICS v_count_iris = ROW_COUNT;

  -- Codes postaux
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'cp', cp.code_postal
  FROM public.ref_codes_postaux cp
  WHERE cp.geom IS NOT NULL
    AND ST_Intersects(cp.geom, v_zone_geom);

  GET DIAGNOSTICS v_count_cp = ROW_COUNT;

  -- Mise à jour compteurs
  UPDATE public.custom_geo_zones
  SET feature_count_iris = v_count_iris,
      feature_count_cp = v_count_cp,
      resolved_at = now()
  WHERE id = p_zone_id;

  RETURN jsonb_build_object(
    'zone_id', p_zone_id,
    'count_iris', v_count_iris,
    'count_cp', v_count_cp
  );
END $$;

REVOKE ALL ON FUNCTION public.resolve_custom_geo_zone_codes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_custom_geo_zone_codes(uuid) TO authenticated;
```

**Sécurité importante** : `SECURITY DEFINER` ici est nécessaire pour bypass les policies sur l'insertion des codes, mais on vérifie **explicitement** que l'user est dans le workspace de la zone (via `organization_members`). Sans ce check, n'importe quel authenticated pourrait résoudre les codes de n'importe quelle zone.

### Test RPC

```sql
-- Crée une zone test (polygone carré autour de Lyon centre)
WITH new_zone AS (
  INSERT INTO public.custom_geo_zones (name, org_id, created_by, source_type, geometry)
  VALUES (
    'Test Lyon',
    (SELECT id FROM public.organizations LIMIT 1),
    auth.uid(),
    'dev_test',
    ST_Multi(ST_MakeEnvelope(4.75, 45.70, 4.95, 45.82, 4326))
  )
  RETURNING id
)
SELECT public.resolve_custom_geo_zone_codes((SELECT id FROM new_zone));
-- Attendu : count_iris ~ 400-600, count_cp ~ 15-30
```

---

## PHASE 3 — ROUTES API

Pattern auth partout : `import { requireAuth } from '@/lib/api/middleware'; const user = await requireAuth(request);`

### 3.1 — `POST /api/custom-geo/save`

Fichier : `app/api/custom-geo/save/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/middleware';
import { createClient } from '@/lib/supabase/server'; // adapter si nom différent

const SaveZoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  source_type: z.string().min(1).max(100),
  source_metadata: z.record(z.unknown()).default({}),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
  org_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const parsed = SaveZoneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: zoneId, error: insertError } = await supabase.rpc('create_custom_geo_zone', {
      p_name: parsed.data.name,
      p_description: parsed.data.description ?? null,
      p_org_id: parsed.data.org_id,
      p_source_type: parsed.data.source_type,
      p_source_metadata: parsed.data.source_metadata,
      p_geometry_geojson: JSON.stringify(parsed.data.geometry),
    });

    if (insertError || !zoneId) {
      return NextResponse.json(
        { error: 'insert_failed', message: insertError?.message },
        { status: 400 }
      );
    }

    const { data: resolveData, error: resolveError } = await supabase.rpc(
      'resolve_custom_geo_zone_codes',
      { p_zone_id: zoneId }
    );

    if (resolveError) {
      // Zone créée mais résolution échouée : on remonte l'erreur mais on garde la zone
      return NextResponse.json(
        {
          zone_id: zoneId,
          warning: 'zone_created_but_resolution_failed',
          message: resolveError.message,
        },
        { status: 207 }
      );
    }

    return NextResponse.json({
      zone_id: zoneId,
      count_iris: resolveData?.count_iris ?? 0,
      count_cp: resolveData?.count_cp ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

### 3.2 — `GET /api/custom-geo/list`

Fichier : `app/api/custom-geo/list/route.ts`

Query params :
- `org_id` (requis, uuid)
- `source_type` (optionnel)
- `q` (optionnel)

Retourne (tri `created_at DESC`, LIMIT 500) :
```ts
{
  zones: Array<{
    id, name, description, source_type, source_metadata,
    feature_count_iris, feature_count_cp,
    bbox: [number, number, number, number] | null,
    created_at, created_by
  }>;
  total: number;
}
```

**Ne PAS renvoyer `geometry`** (trop lourd).

Pour le bbox, faire un SELECT avec `ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox)` — pas `ST_AsGeoJSON(bbox)`.

### 3.3 — `GET /api/custom-geo/[id]`

Détail zone sans géométrie (inclut bbox uniquement).

### 3.4 — `GET /api/custom-geo/[id]/geometry`

Retourne une `Feature` GeoJSON prête pour MapLibre :
```ts
{
  type: 'Feature',
  geometry: { type: 'MultiPolygon', coordinates: [...] },
  properties: { id, name, source_type, source_metadata, feature_count_iris, feature_count_cp }
}
```

Requête SQL : `SELECT ST_AsGeoJSON(geometry)::jsonb AS geom, name, source_type, ...`

### 3.5 — `DELETE /api/custom-geo/[id]`

RLS applique automatiquement (créateur uniquement). Retour `{ deleted: true, id }`.

### 3.6 — `PATCH /api/custom-geo/[id]`

Body : `{ name?: string, description?: string }`. **Pas** la géométrie.

### 3.7 — `GET /api/custom-geo/[id]/export`

Query param `format` : `csv_cp` | `csv_iris` | `geojson`

- `csv_cp` : header `code_postal`, une ligne par code, trié alphabétiquement
- `csv_iris` : header `code_iris`, idem
- `geojson` : FeatureCollection avec la zone brute (+ properties de la zone)

Headers : `Content-Disposition: attachment; filename="zone_<slug>_<format>.<ext>"`

Slug depuis `name` : kebab-case ASCII, fallback `zone_<id8>` si name vide.

---

## PHASE 4 — COMPOSANT `<SaveAsCustomZoneButton />`

Fichier : `components/custom-geo/SaveAsCustomZoneButton.tsx`

C'est la **pièce centrale** qui sera embarquée dans tous les modules sources plus tard.

```tsx
'use client';

import { useState, useCallback } from 'react';

export interface SaveAsCustomZoneButtonProps {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  sourceType: string;
  metadata?: Record<string, unknown>;
  defaultName?: string;
  defaultDescription?: string;
  onSaved?: (result: { zoneId: string; countIris: number; countCp: number }) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}
```

Comportement :
1. Bouton avec label (défaut : "Sauvegarder comme zone custom")
2. Clic → ouvre un modal
3. Modal : champ `name` (pré-rempli `defaultName`), `description` (optionnel), workspace (auto = org de l'user, sélecteur si multi-org détecté)
4. Validation : `name` non vide, géométrie valide (GeoJSON Polygon/MultiPolygon avec `coordinates`)
5. Appel `POST /api/custom-geo/save`
6. Loading state pendant l'appel
7. Succès : toast `Zone "X" sauvegardée — 127 IRIS, 42 CP résolus` + `onSaved()` + fermeture modal
8. Erreur : toast rouge avec message lisible, modal reste ouvert

UI (DESIGN_SYSTEM.md) :
- Bouton : teal `#4ecdc4`, Inter, sentence case
- Modal : overlay `rgba(0,0,0,0.7)`, card `#111111` centrée, 480px max width
- Header `#111111` + bande teal dot pattern
- Pas d'emoji, sentence case partout

**Le composant doit fonctionner en standalone** — aucune dépendance à un module source précis.

---

## PHASE 5 — TYPES PARTAGÉS

Fichier : `types/custom-geo.ts`

```ts
export interface CustomGeoZoneSummary {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
}

export interface CustomGeoZoneFull extends CustomGeoZoneSummary {
  org_id: string;
  resolved_at: string | null;
  updated_at: string;
}

export interface CustomGeoZoneGeometry {
  type: 'Feature';
  geometry: GeoJSON.MultiPolygon;
  properties: {
    id: string;
    name: string;
    source_type: string;
    source_metadata: Record<string, unknown>;
    feature_count_iris: number;
    feature_count_cp: number;
  };
}

export type CustomGeoExportFormat = 'csv_cp' | 'csv_iris' | 'geojson';
```

---

## PHASE 6 — TESTS MANUELS

1. **RPC direct** (SQL Editor) : insérer zone test Lyon, appeler `resolve_custom_geo_zone_codes`, vérifier compteurs cohérents
2. **RLS** : user A crée zone dans org A, user B de org B interroge `list` → vide
3. **Route save** (Postman/cURL avec JWT) : POST polygone GeoJSON, vérifier retour `zone_id + count_iris + count_cp`
4. **Route export** : tester `csv_cp`, `csv_iris`, `geojson` → fichiers téléchargeables corrects
5. **Composant** : page dev `app/dev/test-save-zone/page.tsx` avec polygone Lyon hardcodé, `<SaveAsCustomZoneButton />`, clic, vérifier en base

---

## CONTRAINTES

**Fichiers interdits :**
- `/app/api/isochrone-battle/route.ts`
- Fonctions PostGIS `battle_*`

**Principes GEOMATIK :**
- `source_type` : string libre, **jamais enum**
- `source_metadata` : JSONB libre
- Pas d'hypothèse sur noms de colonnes → les valeurs sont données (Phase 0 déjà faite)

**Sécurité :**
- `SECURITY DEFINER` uniquement sur `resolve_custom_geo_zone_codes` (avec check `organization_members` explicite)
- `SECURITY INVOKER` sur `create_custom_geo_zone` (RLS s'applique)
- `REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO authenticated` sur toutes les RPC
- Validation Zod stricte, aucun `any`
- Routes API : `requireAuth(request)` systématique

**TypeScript :** strict, pas de `any`. Types GeoJSON depuis `@types/geojson`.

**Commit atomique :** `feat(custom-geo): fondations génériques (table + RPC + API + composant)`

---

## POST-LIVRAISON

Après le dernier commit, lance @cleanup-geomatik Partie 2 + Partie 3 sur les fichiers modifiés uniquement. Rapport rapide : failles sécu + any introduits + catch non typés. Corrige avant de considérer la tâche terminée.

---

## LIVRABLES ATTENDUS

1. `supabase/migrations/YYYYMMDDHHMMSS_custom_geo_zones.sql` (tables + triggers + RLS + 2 RPC)
2. `app/api/custom-geo/save/route.ts`
3. `app/api/custom-geo/list/route.ts`
4. `app/api/custom-geo/[id]/route.ts` (GET + PATCH + DELETE)
5. `app/api/custom-geo/[id]/geometry/route.ts`
6. `app/api/custom-geo/[id]/export/route.ts`
7. `components/custom-geo/SaveAsCustomZoneButton.tsx`
8. `types/custom-geo.ts`
9. `lib/version.ts` (bump)
10. `app/dev/test-save-zone/page.tsx` (éphémère, à supprimer après validation manuelle)

---

## RAPPEL — ordre d'exécution

1. Phase 0.6 (multi-org check) → documente la décision
2. Phase 1 (migration SQL tables + RLS)
3. Phase 2 (RPC)
4. Phase 3 (7 routes API)
5. Phase 4 (composant React)
6. Phase 5 (types)
7. Phase 6 (tests manuels, remonte-moi les compteurs zone Lyon)
8. Cleanup @cleanup-geomatik

**Récap final attendu** : compteurs IRIS/CP sur zone Lyon test, temps d'exécution de la RPC de résolution, taille du bundle du composant.