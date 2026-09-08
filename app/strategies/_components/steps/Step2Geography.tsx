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
import { Map as MapIcon } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import type {
  GeographyStep, ScopeType, WeightingMode, Subzone, Tier,
  PreviewStats as PreviewStatsT,
} from '@/lib/strategy-wizard/types';
import { WeightingMiniMap, type SubzoneNative } from './WeightingMiniMap';
import { type CurvePoint } from './CurveEditor';
import type { ZoneSummary, InseeVariableMeta, ZoneDetail } from './step2/shared';
import { pillCls, selectCls, modeLabel } from './step2/shared';
import { PRESET_CURVES } from './step2/presets';
import { Section } from './step2/Section';
import { RichSlider } from './step2/RichSlider';
import { ByTierSliders } from './step2/ByTierSliders';
import { NativeSubzoneSliders } from './step2/NativeSubzoneSliders';
import { BySubzoneInput } from './step2/BySubzoneInput';
import { CSVUploadInput } from './step2/CSVUploadInput';
import { InseeVariableEditor } from './step2/InseeVariableEditor';
import { OutZoneEditor } from './step2/OutZoneEditor';
import { PreviewStats } from './step2/PreviewStats';

interface Props {
  data: GeographyStep;
  onChange: (next: GeographyStep) => void;
}

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
