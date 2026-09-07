'use client';

/**
 * Step2Geography — Périmètre + Pondération.
 *
 * Layout 60/40 :
 *   • Gauche : éditeur (périmètre, mode, multipliers IN/OUT, sous-zones)
 *   • Droite : mini-carte LIVE (choroplèthe des CPs colorés par multiplier),
 *              légende, stats compactes
 *
 * Pour les zones avec sous-zones natives (ex: battle multi-POI = 4 CIRFA),
 * le mode "Par sous-zone" est auto-rempli avec un slider PAR sous-zone, sans
 * que l'utilisateur ait à taper de CPs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload, Map as MapIcon } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import type {
  GeographyStep, ScopeType, WeightingMode, Subzone, Tier,
  PreviewStats as PreviewStatsT,
} from '@/lib/strategy-wizard/types';
import { TIER_LABELS_FR } from '@/lib/strategy-wizard/types';
import {
  colorForMultiplier, plainFrenchForMultiplier,
  interpolateOnCurve,
} from '@/lib/strategy-wizard/multiplier';
import { WeightingMiniMap, type SubzoneNative } from './WeightingMiniMap';
import { CurveEditor, type CurvePoint } from './CurveEditor';

interface Props {
  data: GeographyStep;
  onChange: (next: GeographyStep) => void;
}

interface ZoneSummary {
  id: string;
  name: string;
  source_type: string;
  feature_count_cp: number;
  feature_count_iris: number;
  bbox?: [number, number, number, number] | null;
}

interface InseeVariableMeta {
  code: string;
  label_fr: string;
  category: string;
  description_fr: string;
  unit: string;
  icon: string;
  source: string;
  source_year: number;
  min: number;
  max: number;
  median: number;
  n_cps: number;
}

interface ZoneDetail {
  id: string;
  name: string;
  source_type: string;
  bbox: [number, number, number, number] | null;
  feature_count_iris: number;
  feature_count_cp: number;
  subzones: Array<{
    id: string;
    name: string;
    source_ref: string | null;
    ordering: number;
    default_multiplier: number;
    cp_count: number;
    iris_count: number;
  }>;
}

const TIERS: Tier[] = ['premium_urban', 'urban', 'suburban', 'rural'];
const TIER_DOT: Record<Tier, string> = {
  premium_urban: '#4ecdc4',
  urban: '#7dd3c0',
  suburban: '#f7b731',
  rural: '#a0a0a0',
};

export function Step2Geography({ data, onChange }: Props) {
  // Ref vers la dernière version de `data` — utilisé par les useEffects async
  // pour éviter les closures périmées qui se bousculent entre eux (sinon un
  // useEffect peut écraser un changement fait par un autre dans le même tick).
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const set = <K extends keyof GeographyStep>(k: K, v: GeographyStep[K]) =>
    onChange({ ...data, [k]: v });

  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [zoneDetail, setZoneDetail] = useState<ZoneDetail | null>(null);
  const [zoneCps, setZoneCps] = useState<Array<{ code: string; subzone_id: string | null }> | null>(null);
  const [previewStats, setPreviewStats] = useState<PreviewStatsT | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Multipliers par sous-zone native (clé = subzone_id) — controlé ici
  const [nativeSubzoneMultipliers, setNativeSubzoneMultipliers] = useState<Record<string, number>>({});

  // Variables INSEE disponibles + valeurs de la variable sélectionnée
  const [inseeVariables, setInseeVariables] = useState<InseeVariableMeta[]>([]);
  const [inseeValues, setInseeValues] = useState<Record<string, number>>({});

  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  // Fetch liste variables INSEE quand le mode by_insee_variable est sélectionné
  useEffect(() => {
    if (data.weighting_mode !== 'by_insee_variable') return;
    if (inseeVariables.length > 0) return;
    adminFetch('/api/insee-variables/list', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { variables: [] })
      .then(j => setInseeVariables((j.variables ?? []) as InseeVariableMeta[]))
      .catch(() => setInseeVariables([]));
  }, [data.weighting_mode, inseeVariables.length]);

  // Fetch valeurs de la variable sélectionnée (toute la France pour démo)
  const selectedVariableCode = (data.in_zone_weights as { variable_code?: string }).variable_code;
  useEffect(() => {
    if (data.weighting_mode !== 'by_insee_variable') return;
    if (!selectedVariableCode) return;
    adminFetch(`/api/insee-variables/${selectedVariableCode}/values`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { values: {} })
      .then(j => setInseeValues((j.values ?? {}) as Record<string, number>))
      .catch(() => setInseeValues({}));
  }, [data.weighting_mode, selectedVariableCode]);

  // ─── Liste des zones custom (au switch en mode custom_zone) ──────────────
  useEffect(() => {
    if (data.scope_type !== 'custom_zone') return;
    if (!orgId) return;
    adminFetch(`/api/custom-geo/list?org_id=${orgId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { zones: [] })
      .then(j => setZones((j.zones ?? []) as ZoneSummary[]))
      .catch(() => setZones([]));
  }, [data.scope_type, orgId]);

  // ─── Détail de la zone sélectionnée (sous-zones + bbox) ──────────────────
  useEffect(() => {
    if (!data.zone_id || data.scope_type !== 'custom_zone') {
      setZoneDetail(null);
      setZoneCps(null);
      setNativeSubzoneMultipliers({});
      return;
    }
    let cancelled = false;
    Promise.all([
      adminFetch(`/api/custom-geo/${data.zone_id}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null),
      adminFetch(`/api/custom-geo/${data.zone_id}/codes?type=cp`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null),
    ]).then(([detail, codes]) => {
      if (cancelled) return;
      if (detail) {
        setZoneDetail(detail as ZoneDetail);
        // Initialise les multipliers par sous-zone à leur default
        const initMul: Record<string, number> = {};
        for (const sz of (detail as ZoneDetail).subzones ?? []) {
          initMul[sz.id] = sz.default_multiplier ?? 1.0;
        }
        setNativeSubzoneMultipliers(initMul);
      }
      if (codes) setZoneCps(codes.codes ?? []);
    }).catch(() => { /* silencieux */ });
    return () => { cancelled = true; };
  }, [data.zone_id, data.scope_type]);

  // ─── Auto-bascule en mode by_subzone + persist des subzones natives ──────
  // Consolidé en 1 seul useEffect (lit dataRef.current) pour éviter les
  // closures périmées entre 2 effects qui se bousculaient (mode revenait à uniform).
  const [autoSwitchedFor, setAutoSwitchedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!zoneDetail || !data.zone_id || !zoneCps) return;
    if (autoSwitchedFor === data.zone_id) return;
    const hasMulti = (zoneDetail.subzones?.length ?? 0) >= 2;
    if (!hasMulti) {
      setAutoSwitchedFor(data.zone_id);
      return;
    }
    const subzonesPersist: Subzone[] = (zoneDetail.subzones ?? []).map(sz => ({
      name: sz.name,
      postal_codes: zoneCps.filter(c => c.subzone_id === sz.id).map(c => c.code),
      multiplier: nativeSubzoneMultipliers[sz.id] ?? sz.default_multiplier,
    }));
    onChange({
      ...dataRef.current,
      weighting_mode: 'by_subzone',
      in_zone_weights: { mode: 'by_subzone', value: 1.0 },
      subzones: subzonesPersist,
    });
    setAutoSwitchedFor(data.zone_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneDetail, data.zone_id, zoneCps]);

  // Map CP → subzoneId pour la mini-map (override par sous-zone native)
  const cpToSubzone = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of zoneCps ?? []) {
      if (c.subzone_id) m.set(c.code, c.subzone_id);
    }
    return m;
  }, [zoneCps]);

  const inZoneCps = useMemo(() => {
    const s = new Set<string>();
    for (const c of zoneCps ?? []) s.add(c.code);
    return s;
  }, [zoneCps]);

  // Sous-zones natives (avec multiplier courant, pour la mini-map et la légende)
  const nativeSubzones: SubzoneNative[] | undefined = useMemo(() => {
    if (!zoneDetail || !zoneDetail.subzones || zoneDetail.subzones.length === 0) return undefined;
    return zoneDetail.subzones.map(sz => ({
      id: sz.id,
      name: sz.name,
      cp_count: sz.cp_count,
      iris_count: sz.iris_count,
      multiplier: nativeSubzoneMultipliers[sz.id] ?? sz.default_multiplier,
    }));
  }, [zoneDetail, nativeSubzoneMultipliers]);

  const hasNativeSubzones = (nativeSubzones?.length ?? 0) >= 2;

  // ─── Preview stats (debounced 600ms, comme avant) ────────────────────────
  useEffect(() => {
    if (data.scope_type === 'custom_zone' && !data.zone_id) {
      setPreviewStats(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        // Construit subzones[] depuis les natives (overrides) si pertinent
        const subzonesPayload: Subzone[] = hasNativeSubzones && zoneCps
          ? (nativeSubzones ?? []).map(sz => ({
              name: sz.name,
              postal_codes: zoneCps.filter(c => c.subzone_id === sz.id).map(c => c.code),
              multiplier: sz.multiplier,
            }))
          : (data.subzones ?? []);

        const res = await adminFetch('/api/bidding/strategies/preview-weights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope_type: data.scope_type,
            zone_id: data.zone_id ?? null,
            in_zone_weights: data.in_zone_weights,
            out_zone_weights: data.out_zone_weights,
            subzones: subzonesPayload,
            sample_size: 500,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          setPreviewStats(j.stats);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [data.scope_type, data.zone_id, data.in_zone_weights, data.out_zone_weights, data.subzones, hasNativeSubzones, nativeSubzones, zoneCps]);

  // Persiste les changements de multiplier des sous-zones natives.
  // Lit dataRef.current pour ne pas écraser les autres champs (mode, etc.).
  useEffect(() => {
    if (!hasNativeSubzones || !zoneCps) return;
    // Skip le tout premier render : la valeur initiale est déjà persistée par
    // l'auto-switch ci-dessus, ce useEffect ne tracke que les VRAIS changements.
    if (autoSwitchedFor !== data.zone_id) return;
    const subzonesPersist: Subzone[] = (nativeSubzones ?? []).map(sz => ({
      name: sz.name,
      postal_codes: zoneCps.filter(c => c.subzone_id === sz.id).map(c => c.code),
      multiplier: sz.multiplier,
    }));
    onChange({ ...dataRef.current, subzones: subzonesPersist });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeSubzoneMultipliers, hasNativeSubzones, zoneCps?.length, autoSwitchedFor]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const switchScope = (s: ScopeType) =>
    onChange({ ...data, scope_type: s, zone_id: s === 'national' ? null : data.zone_id ?? null });

  const switchMode = (m: WeightingMode) => {
    const defaults: Record<WeightingMode, { in: Record<string, unknown>; out: Record<string, unknown> }> = {
      uniform: { in: { mode: 'uniform', value: 1.5 }, out: { mode: 'uniform', value: 0.7 } },
      by_tier: { in: { mode: 'by_tier', values: { premium_urban: 2.0, urban: 1.5, suburban: 1.0, rural: 0.8 } }, out: { mode: 'uniform', value: 0.7 } },
      by_subzone: { in: { mode: 'by_subzone', value: 1.0 }, out: { mode: 'uniform', value: 0.7 } },
      by_cp_csv: { in: { mode: 'by_cp_csv', values: {} }, out: { mode: 'uniform', value: 0.7 } },
      by_insee_variable: { in: { mode: 'by_insee_variable', variable_code: 'abstention_pres_2022', curve: PRESET_CURVES.boost_decroches }, out: { mode: 'uniform', value: 0.0 } },
    };
    onChange({ ...data, weighting_mode: m, in_zone_weights: defaults[m].in, out_zone_weights: defaults[m].out });
  };

  const updateNativeSubzone = (subzoneId: string, mult: number) => {
    setNativeSubzoneMultipliers(prev => ({ ...prev, [subzoneId]: mult }));
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* COLONNE GAUCHE — éditeur */}
      <div className="flex flex-col gap-6">
        <Section title="1. Périmètre géographique" tagline="National = toute la France · Zone custom = une zone que vous avez sauvegardée depuis la carte">
          <div className="flex gap-2">
            {(['national', 'custom_zone'] as ScopeType[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => switchScope(s)}
                className={pillCls(data.scope_type === s)}
              >
                {s === 'national' ? 'National (toute la France)' : 'Zone custom'}
              </button>
            ))}
          </div>

          {data.scope_type === 'custom_zone' && (
            <div className="mt-3">
              <label className="block text-[11px] text-text-tertiary mb-1">Choix de la zone</label>
              <select
                className={selectCls}
                value={data.zone_id ?? ''}
                onChange={(e) => set('zone_id', e.target.value || null)}
              >
                <option value="">— Sélectionner —</option>
                {(zones ?? []).map(z => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.source_type}, {z.feature_count_cp} CPs / {z.feature_count_iris} IRIS)
                  </option>
                ))}
              </select>
              {hasNativeSubzones && (
                <p className="text-[11px] text-accent-teal mt-2">
                  ✨ Cette zone contient {nativeSubzones!.length} sous-zones natives — chaque sous-zone est pondérable séparément ci-dessous.
                </p>
              )}
              <p className="text-[11px] text-text-tertiary mt-2">
                Pour créer une nouvelle zone, allez dans Module Carte → Capture custom geo.
              </p>
            </div>
          )}
        </Section>

        <Section
          title="2. Mode de pondération"
          tagline={
            data.weighting_mode === 'uniform' ? 'Même boost partout dans la zone — démarrage simple.'
            : data.weighting_mode === 'by_tier' ? 'Boost différent selon densité urbaine du CP (premium / dense / périurbain / rural).'
            : data.weighting_mode === 'by_subzone' ? hasNativeSubzones
              ? 'Pondère chaque sous-zone native indépendamment.'
              : 'Définissez vous-même des sous-zones avec leurs CPs.'
            : 'Importez un CSV postal_code,multiplier (un score par CP).'
          }
        >
          <div className="flex flex-wrap gap-2">
            {(['uniform', 'by_tier', 'by_subzone', 'by_cp_csv', 'by_insee_variable'] as WeightingMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={pillCls(data.weighting_mode === m)}
              >
                {modeLabel(m)}
                {m === 'by_insee_variable' && <span className="ml-1 text-accent-teal">✨</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section title="3. Multipliers DANS la zone">
          {data.weighting_mode === 'uniform' && (
            <RichSlider
              value={Number((data.in_zone_weights as { value?: number }).value ?? 1.5)}
              onChange={(v) => set('in_zone_weights', { mode: 'uniform', value: v })}
              label="Multiplier dans la zone"
            />
          )}

          {data.weighting_mode === 'by_tier' && (
            <ByTierSliders
              values={((data.in_zone_weights as { values?: Partial<Record<Tier, number>> }).values) ?? {}}
              onChange={(values) => set('in_zone_weights', { mode: 'by_tier', values })}
            />
          )}

          {data.weighting_mode === 'by_subzone' && hasNativeSubzones && (
            <NativeSubzoneSliders
              subzones={nativeSubzones!}
              onChange={updateNativeSubzone}
            />
          )}

          {data.weighting_mode === 'by_subzone' && !hasNativeSubzones && (
            <BySubzoneInput
              subzones={data.subzones ?? []}
              onChange={(subzones) => set('subzones', subzones)}
              fallbackValue={Number((data.in_zone_weights as { value?: number }).value ?? 1.0)}
              onFallbackChange={(v) => set('in_zone_weights', { mode: 'by_subzone', value: v })}
            />
          )}

          {data.weighting_mode === 'by_cp_csv' && (
            <CSVUploadInput
              values={((data.in_zone_weights as { values?: Record<string, number> }).values) ?? {}}
              onChange={(values) => set('in_zone_weights', { mode: 'by_cp_csv', values })}
            />
          )}

          {data.weighting_mode === 'by_insee_variable' && (
            <InseeVariableEditor
              variables={inseeVariables}
              variableCode={selectedVariableCode ?? 'abstention_pres_2022'}
              curve={((data.in_zone_weights as { curve?: CurvePoint[] }).curve) ?? PRESET_CURVES.boost_decroches}
              onVariableChange={(code) => {
                set('in_zone_weights', {
                  mode: 'by_insee_variable',
                  variable_code: code,
                  curve: PRESET_CURVES.boost_decroches,
                });
              }}
              onCurveChange={(curve) => {
                set('in_zone_weights', {
                  mode: 'by_insee_variable',
                  variable_code: selectedVariableCode ?? 'abstention_pres_2022',
                  curve,
                });
              }}
              onPresetApply={(presetKey) => {
                set('in_zone_weights', {
                  mode: 'by_insee_variable',
                  variable_code: selectedVariableCode ?? 'abstention_pres_2022',
                  curve: PRESET_CURVES[presetKey],
                });
              }}
              inseeValues={inseeValues}
            />
          )}
        </Section>

        <Section title="4. Hors de la zone">
          <OutZoneEditor
            value={data.out_zone_weights}
            onChange={(v) => set('out_zone_weights', v)}
          />
        </Section>
      </div>

      {/* COLONNE DROITE — mini-map + stats */}
      <aside className="lg:sticky lg:top-2 lg:self-start flex flex-col gap-3">
        <h4 className="flex items-center gap-2 text-[12px] font-medium text-text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
          <MapIcon className="h-3.5 w-3.5 text-accent-teal" />
          Aperçu live
        </h4>

        <WeightingMiniMap
          bbox={zoneDetail?.bbox ?? null}
          inZoneCps={inZoneCps}
          cpToSubzone={cpToSubzone}
          subzones={nativeSubzones}
          inZoneWeights={data.in_zone_weights}
          outZoneWeights={data.out_zone_weights}
          manualSubzones={hasNativeSubzones ? undefined : (data.subzones ?? undefined)}
          inseeValues={data.weighting_mode === 'by_insee_variable' ? inseeValues : undefined}
          fullFranceMode={data.weighting_mode === 'by_insee_variable' && data.scope_type === 'national'}
          height={300}
        />

        <PreviewStats stats={previewStats} loading={previewLoading} />
      </aside>
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function Section({ title, tagline, children }: { title: string; tagline?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12px] font-medium text-text-primary mb-1">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
        {title}
      </h3>
      {tagline && <p className="text-[11px] text-text-tertiary mb-3">{tagline}</p>}
      <div className={tagline ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function modeLabel(m: WeightingMode): string {
  if (m === 'uniform') return 'Uniforme';
  if (m === 'by_tier') return 'Par tier';
  if (m === 'by_subzone') return 'Par sous-zone';
  if (m === 'by_cp_csv') return 'CSV par CP';
  if (m === 'by_insee_variable') return 'Par variable INSEE';
  return m;
}

// =====================================================================
// PRESET_CURVES — courbes narratives pour mode by_insee_variable
// =====================================================================

type PresetKey = 'boost_decroches' | 'renforcer_engages' | 'cibler_milieu';

const PRESET_CURVES: Record<PresetKey, CurvePoint[]> = {
  // Boost les zones où la variable est ÉLEVÉE (ex: forte abstention → boost)
  boost_decroches: [
    { x: 0,   y: 0.3 },
    { x: 25,  y: 0.6 },
    { x: 35,  y: 1.5 },
    { x: 50,  y: 3.0 },
    { x: 100, y: 3.5 },
  ],
  // Boost les zones où la variable est BASSE (ex: faible abstention → boost engagés)
  renforcer_engages: [
    { x: 0,   y: 3.0 },
    { x: 20,  y: 2.0 },
    { x: 35,  y: 1.0 },
    { x: 50,  y: 0.5 },
    { x: 100, y: 0.3 },
  ],
  // Cible la médiane (focus sur les zones intermédiaires, ignore les extrêmes)
  cibler_milieu: [
    { x: 0,   y: 0.3 },
    { x: 20,  y: 0.8 },
    { x: 30,  y: 2.5 },
    { x: 40,  y: 2.5 },
    { x: 50,  y: 0.8 },
    { x: 100, y: 0.3 },
  ],
};

const PRESET_LABELS: Record<PresetKey, string> = {
  boost_decroches:    'Cibler les zones décrochées',
  renforcer_engages:  'Renforcer les engagés',
  cibler_milieu:      'Ignorer les extrêmes',
};

const PRESET_TAGLINES: Record<PresetKey, string> = {
  boost_decroches:    'Boost progressif des CPs où la variable est élevée',
  renforcer_engages:  'Concentre le budget sur les CPs où la variable est basse',
  cibler_milieu:      'Cloche centrée sur la médiane — ignore les extrêmes',
};

// =====================================================================
// InseeVariableEditor — dropdown variable + 3 presets + CurveEditor
// =====================================================================

function InseeVariableEditor({
  variables, variableCode, curve, onVariableChange, onCurveChange, onPresetApply, inseeValues,
}: {
  variables: InseeVariableMeta[];
  variableCode: string;
  curve: CurvePoint[];
  onVariableChange: (code: string) => void;
  onCurveChange: (curve: CurvePoint[]) => void;
  onPresetApply: (key: PresetKey) => void;
  inseeValues: Record<string, number>;
}) {
  const variable = variables.find(v => v.code === variableCode);

  // Calcul "ratio sociétal" : combien de CPs / inscrits sont concernés par boost > 1.5
  const ratio = useMemo(() => {
    if (!variable || Object.keys(inseeValues).length === 0) return null;
    const total = Object.keys(inseeValues).length;
    let boosted = 0;
    let valSum = 0;
    let boostedValSum = 0;
    for (const cp in inseeValues) {
      const v = inseeValues[cp];
      const m = interpolateOnCurve(curve, v);
      if (m > 1.5) {
        boosted++;
        boostedValSum += v;
      }
      valSum += v;
    }
    return {
      n_total: total,
      n_boosted: boosted,
      pct_boosted: total > 0 ? (boosted / total) * 100 : 0,
      avg_value_boosted: boosted > 0 ? boostedValSum / boosted : 0,
      avg_value_total: total > 0 ? valSum / total : 0,
    };
  }, [variable, inseeValues, curve]);

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {/* Dropdown variable */}
      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Variable de pondération</label>
        <select
          value={variableCode}
          onChange={(e) => onVariableChange(e.target.value)}
          className={selectCls}
        >
          {variables.length === 0 && <option value="abstention_pres_2022">Chargement…</option>}
          {variables.map(v => (
            <option key={v.code} value={v.code}>
              {v.icon} {v.label_fr} ({v.source_year})
            </option>
          ))}
        </select>
        {variable && (
          <p className="text-[11px] text-text-tertiary mt-1.5">{variable.description_fr}</p>
        )}
      </div>

      {/* Presets narratifs */}
      <div>
        <div className="text-[11px] text-text-tertiary mb-1.5">Stratégie de ciblage rapide</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_LABELS) as PresetKey[]).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => onPresetApply(key)}
              title={PRESET_TAGLINES[key]}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-accent-teal/40 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20 transition-colors"
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* CurveEditor */}
      {variable && (
        <div className="border border-border-subtle rounded-md bg-bg-level-1 p-3">
          <div className="text-[11px] text-text-tertiary mb-1">Courbe de pondération · drag les poignées</div>
          <CurveEditor
            value={curve}
            onChange={onCurveChange}
            xMin={0}
            xMax={Math.ceil(variable.max / 5) * 5}
            xUnit={variable.unit}
            xMedian={variable.median}
            height={200}
          />
        </div>
      )}

      {/* Bandeau ratio sociétal */}
      {ratio && variable && (
        <div className="border border-accent-teal/30 bg-accent-teal/5 rounded-md p-3">
          <div className="text-[11px] text-accent-teal font-medium mb-1">📊 Impact de votre courbe</div>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            <span className="text-text-primary font-medium">{ratio.n_boosted.toLocaleString('fr-FR')}</span> CPs ciblés (boost ≥ ×1.5) sur {ratio.n_total.toLocaleString('fr-FR')} —
            soit <span className="text-text-primary font-medium">{ratio.pct_boosted.toFixed(0)}%</span> du territoire.{' '}
            {ratio.n_boosted > 0 && (
              <>
                Sur ces zones, la {variable.label_fr.toLowerCase()} moyenne est de{' '}
                <span className="text-text-primary font-medium">{ratio.avg_value_boosted.toFixed(1)}{variable.unit}</span>
                {' '}(vs {ratio.avg_value_total.toFixed(1)}{variable.unit} en moyenne France).
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Slider riche : barre de couleur (gradient via stops), curseur, valeur big,
 * markers aux valeurs charnières (×0, ×0.5, ×1, ×1.5, ×2, ×3, ×5),
 * phrase plain-french en-dessous.
 */
function RichSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const color = colorForMultiplier(value);
  const explanation = plainFrenchForMultiplier(value);
  return (
    <div className="flex flex-col gap-3 max-w-md">
      <span className="text-[11px] text-text-tertiary">{label}</span>

      <div>
        <input
          type="range"
          min={0} max={5} step={0.1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-accent-teal"
          style={{ accentColor: color }}
        />
        <div className="flex justify-between text-[9px] font-mono text-text-tertiary mt-1">
          <span>×0</span><span>×0.5</span><span>×1</span><span>×1.5</span><span>×2</span><span>×3</span><span>×5</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="text-lg font-mono font-medium px-3 py-1 rounded"
          style={{ background: color + '22', color }}
        >
          ×{value.toFixed(2)}
        </div>
        <p className="text-[11px] text-text-secondary">{explanation}</p>
      </div>
    </div>
  );
}

function ByTierSliders({ values, onChange }: { values: Partial<Record<Tier, number>>; onChange: (v: Partial<Record<Tier, number>>) => void }) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {TIERS.map(t => {
        const v = values[t] ?? 1.0;
        const color = colorForMultiplier(v);
        const delta = v - 1;
        return (
          <div key={t} className="flex items-center gap-3">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: TIER_DOT[t] }}
            />
            <span className="w-32 text-xs text-text-secondary shrink-0">{TIER_LABELS_FR[t]}</span>
            <input
              type="range"
              min={0} max={5} step={0.1}
              value={v}
              onChange={(e) => onChange({ ...values, [t]: parseFloat(e.target.value) })}
              className="flex-1"
              style={{ accentColor: color }}
            />
            <span className="w-16 text-right text-xs font-mono" style={{ color }}>×{v.toFixed(2)}</span>
            <span className="w-16 text-right text-[10px] font-mono text-text-tertiary">
              {delta > 0 ? `+${Math.round(delta * 100)}%` : delta < 0 ? `${Math.round(delta * 100)}%` : 'base'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pondération native par sous-zone (issu de la zone custom multi-POI).
 * 1 slider par sous-zone, pastille couleur identique à la légende de la mini-map.
 */
function NativeSubzoneSliders({
  subzones, onChange,
}: {
  subzones: SubzoneNative[];
  onChange: (subzoneId: string, mult: number) => void;
}) {
  const SUBZONE_COLORS = ['#4ecdc4', '#f7b731', '#e879f9', '#60a5fa', '#fb923c', '#34d399', '#f472b6', '#a78bfa'];
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {subzones.map((sz, i) => {
        const v = sz.multiplier;
        const color = colorForMultiplier(v);
        const accent = SUBZONE_COLORS[i % SUBZONE_COLORS.length];
        const delta = v - 1;
        return (
          <div key={sz.id} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: accent }} />
            <div className="w-44 shrink-0 min-w-0">
              <div className="text-xs text-text-primary truncate">{sz.name}</div>
              <div className="text-[10px] font-mono text-text-tertiary">{sz.cp_count} CPs · {sz.iris_count} IRIS</div>
            </div>
            <input
              type="range"
              min={0} max={5} step={0.1}
              value={v}
              onChange={(e) => onChange(sz.id, parseFloat(e.target.value))}
              className="flex-1"
              style={{ accentColor: color }}
            />
            <span className="w-16 text-right text-xs font-mono" style={{ color }}>×{v.toFixed(2)}</span>
            <span className="w-16 text-right text-[10px] font-mono text-text-tertiary">
              {delta > 0 ? `+${Math.round(delta * 100)}%` : delta < 0 ? `${Math.round(delta * 100)}%` : 'base'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BySubzoneInput({ subzones, onChange, fallbackValue, onFallbackChange }: {
  subzones: Subzone[];
  onChange: (s: Subzone[]) => void;
  fallbackValue: number;
  onFallbackChange: (v: number) => void;
}) {
  const add = () => onChange([...subzones, { name: '', postal_codes: [], multiplier: 1.0 }]);
  const update = (i: number, patch: Partial<Subzone>) =>
    onChange(subzones.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(subzones.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
      {subzones.map((sz, i) => {
        const v = sz.multiplier;
        const color = colorForMultiplier(v);
        return (
          <div key={i} className="flex items-center gap-2 border border-border-subtle rounded-md p-2 bg-bg-level-1">
            <input
              type="text"
              placeholder="Nom de la sous-zone"
              value={sz.name}
              onChange={(e) => update(i, { name: e.target.value })}
              className={inputCls + ' flex-1'}
            />
            <input
              type="text"
              placeholder="CPs (75001,75002,…)"
              value={sz.postal_codes.join(',')}
              onChange={(e) => update(i, { postal_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className={inputCls + ' flex-[2]'}
            />
            <input
              type="number"
              min={0} max={5} step={0.1}
              value={sz.multiplier}
              onChange={(e) => update(i, { multiplier: parseFloat(e.target.value) || 0 })}
              className={inputCls + ' w-20 text-right'}
              style={{ borderColor: color + '88' }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-2 text-text-tertiary hover:text-geo-danger"
              aria-label="supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 text-xs text-accent-teal hover:text-accent-teal-hover py-2"
      >
        <Plus className="h-4 w-4" /> Ajouter une sous-zone
      </button>

      <div className="border-t border-border-subtle pt-3 mt-2">
        <RichSlider
          value={fallbackValue}
          onChange={onFallbackChange}
          label="Multiplier des CPs non assignés à une sous-zone"
        />
      </div>
    </div>
  );
}

function CSVUploadInput({ values, onChange }: { values: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (f: File) => {
    setError(null);
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      setError('CSV vide ou sans header.');
      return;
    }
    const next: Record<string, number> = {};
    let bad = 0;
    for (let i = 1; i < lines.length; i++) {
      const [cp, mul] = lines[i].split(/[,;]/).map(s => s.trim());
      const m = parseFloat(mul);
      if (cp && !Number.isNaN(m)) next[cp] = Math.max(0, Math.min(5, m));
      else bad++;
    }
    onChange(next);
    if (bad > 0) setError(`${bad} ligne(s) ignorée(s) (parsing échoué).`);
  };

  const count = Object.keys(values).length;
  // Histogramme : compte des CPs par bucket de multiplier
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0, 0, 0]; // <0.5 / 0.5-0.9 / 0.9-1.1 / 1.1-1.5 / 1.5-2 / 2-3 / 3+
    for (const m of Object.values(values)) {
      if (m < 0.5) b[0]++;
      else if (m < 0.9) b[1]++;
      else if (m < 1.1) b[2]++;
      else if (m < 1.5) b[3]++;
      else if (m < 2) b[4]++;
      else if (m < 3) b[5]++;
      else b[6]++;
    }
    const max = Math.max(...b, 1);
    return { b, max };
  }, [values]);

  return (
    <div className="flex flex-col gap-2 max-w-xl">
      <label className="flex items-center gap-2 cursor-pointer">
        <span className="px-3 py-2 rounded-md border border-border-subtle bg-bg-level-1 text-xs text-text-secondary hover:border-border-hover hover:text-text-primary flex items-center gap-2">
          <Upload className="h-4 w-4" /> Uploader un CSV
        </span>
        <input
          type="file"
          accept=".csv,.txt"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />
        {count > 0 && <span className="text-[11px] text-text-secondary">{count} CPs chargés</span>}
      </label>
      <p className="text-[11px] text-text-tertiary">
        Format : <code>postal_code,multiplier</code> (header obligatoire). Ex : <code>75001,2.5</code>
      </p>
      {error && <p className="text-[11px] text-geo-danger">{error}</p>}

      {count > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-text-tertiary mb-1">Distribution des multipliers</div>
          <div className="flex items-end gap-0.5 h-12">
            {buckets.b.map((c, i) => {
              const colors = ['#1a1a1a', '#ef4444', '#f97316', '#a0a0a0', '#7dd3c0', '#4ecdc4', '#2a9d8f'];
              return (
                <div
                  key={i}
                  title={`${c} CPs`}
                  className="flex-1 rounded-t"
                  style={{ background: colors[i], height: `${(c / buckets.max) * 100}%`, minHeight: c > 0 ? 2 : 0 }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-text-tertiary mt-1">
            <span>×0</span><span>×0.5</span><span>×1</span><span>×1.5</span><span>×2</span><span>×3</span><span>×5+</span>
          </div>
        </div>
      )}
    </div>
  );
}

function OutZoneEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const mode = (value.mode as string) ?? 'uniform';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange({ mode: 'uniform', value: 0.7 })} className={pillCls(mode === 'uniform')}>Réduction uniforme</button>
        <button type="button" onClick={() => onChange({ mode: 'by_tier', values: { premium_urban: 1.0, urban: 0.8, suburban: 0.6, rural: 0.4 } })} className={pillCls(mode === 'by_tier')}>Par tier</button>
        <button type="button" onClick={() => onChange({ mode: 'exclusion' })} className={pillCls(mode === 'exclusion')}>Exclusion totale (×0)</button>
      </div>

      {mode === 'uniform' && (
        <RichSlider
          value={Number(value.value ?? 0.7)}
          onChange={(v) => onChange({ mode: 'uniform', value: v })}
          label="Multiplier hors de la zone"
        />
      )}
      {mode === 'by_tier' && (
        <ByTierSliders
          values={(value.values as Partial<Record<Tier, number>>) ?? {}}
          onChange={(values) => onChange({ mode: 'by_tier', values })}
        />
      )}
      {mode === 'exclusion' && (
        <p className="text-xs text-text-secondary">Aucune dépense hors de la zone (multiplier ×0).</p>
      )}
    </div>
  );
}

function PreviewStats({ stats, loading }: { stats: PreviewStatsT | null; loading: boolean }) {
  return (
    <div className="bg-bg-level-1 border border-border-subtle rounded-md p-3">
      <h4 className="text-[11px] font-medium text-text-secondary mb-2">Statistiques (échantillon)</h4>
      {loading && <p className="text-[11px] text-text-tertiary">calcul…</p>}
      {!loading && !stats && <p className="text-[11px] text-text-tertiary">Sélectionnez une zone pour voir l&apos;aperçu.</p>}
      {!loading && stats && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono">
          <KV label="CPs in-zone" value={stats.n_in_zone.toLocaleString('fr-FR')} />
          <KV label="CPs out-zone" value={stats.n_out_zone.toLocaleString('fr-FR')} />
          <KV label="Exclus (×0)" value={stats.n_excluded.toLocaleString('fr-FR')} />
          <KV label="Échantillon" value={stats.n_total_sampled.toLocaleString('fr-FR')} />
          <KV label="Mult. moyen IN" value={stats.avg_multiplier_in.toFixed(2)} />
          <KV label="Mult. moyen OUT" value={stats.avg_multiplier_out.toFixed(2)} />
          <KV label="Budget IN %" value={stats.budget_share_in_pct.toFixed(1) + '%'} />
          <KV label="Budget OUT %" value={stats.budget_share_out_pct.toFixed(1) + '%'} />
        </dl>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="text-text-secondary text-right">{value}</dd>
    </>
  );
}

const inputCls = 'bg-bg-level-2 border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-teal/50';
const selectCls = 'w-full bg-bg-level-2 border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-teal/50';

function pillCls(active: boolean) {
  return `px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
    active
      ? 'border-accent-teal/50 bg-bg-level-2 text-text-primary'
      : 'border-border-subtle bg-bg-level-1 text-text-secondary hover:border-border-hover hover:text-text-primary'
  }`;
}
