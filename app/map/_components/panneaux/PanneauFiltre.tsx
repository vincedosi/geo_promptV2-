'use client';

/**
 * @file app/map/_components/panneaux/PanneauFiltre.tsx — panneau « Filtre »
 *
 * Contenu de l'entree « Filtre » du rail (lib/navigation/config.ts) : « Ou je
 * regarde ». Compose un UNIQUE `FiltreActif` (lib/carte/filtre.ts, fichier
 * protege — non modifie) a partir de trois sources :
 *   1. le decoupage administratif + la recherche locale, repris TEL QUEL de
 *      `PerimeterSections` (app/map/_components/filter-panel/PerimeterSections.tsx) —
 *      ce composant affiche, dans cet ordre fixe par sa propre structure JSX,
 *      le perimetre global (Metro / +DROM), les regions, les departements PUIS
 *      la recherche locale (ville/CP). Ne pas decrire un autre ordre : celui-ci
 *      est celui produit par le composant reutilise, pas celui du brief.
 *   2. « Filtrer sur une zone enregistree » — liste dynamique via
 *      `GET /api/custom-geo/list` (meme contrat que `ZonesOverlay`).
 *
 * Chaque selection compose un `FiltreActif` et appelle `onFiltre(poserFiltre(...))`
 * — un seul filtre actif a la fois, source unique dans `page.tsx`.
 *
 * Simplifications assumees (TypeFiltre est un fichier protege, pas de valeur
 * pour un perimetre national) :
 *   - Le perimetre global (« France Metro » / « France + DROM ») reste un
 *     reglage purement visuel du widget reutilise : il ne compose PAS de
 *     `FiltreActif` (aucune valeur de `TypeFiltre` ne correspond a un scope
 *     national, et elargir la bbox sur « + DROM » violerait la regle
 *     CLAUDE.md « jamais France entiere »).
 *   - Region / departement / commune / code postal composent un `FiltreActif`
 *     SANS bbox resolue (le referentiel regions/departements ne porte pas de
 *     bbox) : `bboxDuFiltre` replie alors sur `BBOX_METRO`, jamais une bbox
 *     plus large — comportement volontaire, jamais un elargissement.
 *   - Seule une zone enregistree porte une bbox reellement resolue (colonne
 *     `bbox` de `custom_geo_zones`), donc borne les requetes plus finement.
 *   - `PerimeterSections` accepte une SELECTION MULTIPLE de regions/departements
 *     (widget partage avec `FilterPanel`) ; un `FiltreActif` est unique. Ce
 *     panneau emule une selection simple : choisir une nouvelle region/departement
 *     remplace la precedente, et une deselection retire le filtre s'il portait
 *     sur ce type.
 *   - Le masque « afficher uniquement le territoire » de `PerimeterSections`
 *     est desactive ici (adminScale/adminCodes figes a vide) : il pilote un
 *     contexte de capture GLOBAL (`useAdminScopeLayer`/`useCustomGeoCaptureContext`)
 *     deja instancie par `FilterPanel` pour Calques/Analyse — une seconde
 *     instance ici entrerait en conflit avec le meme id de couche.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { adminFetch } from '@/lib/admin-fetch';
import type { CustomGeoZoneSummary } from '@/types/custom-geo';
import { PerimeterSections } from '@/app/map/_components/filter-panel/PerimeterSections';
import { FilterSectionHeader } from '@/app/map/_components/filter-panel/FilterSectionHeader';
import { useFilterSections } from '@/app/map/_components/filter-panel/use-filter-sections';
import { useTerritorySelection } from '@/app/map/_components/filter-panel/use-territory-selection';
import { C, fInter, fMono } from '@/app/map/_components/filter-panel/tokens';
import { poserFiltre, type FiltreActif } from '@/lib/carte/filtre';

interface PanneauFiltreProps {
  /** Filtre actif — un seul, source unique dans `page.tsx`. */
  filtre: FiltreActif | null;
  /** Remonte le nouveau filtre (ou null) au parent. */
  onFiltre: (filtre: FiltreActif | null) => void;
}

/** Debounce recherche locale (ville) : evite de composer un filtre a chaque frappe. */
const DEBOUNCE_MS = 400;

export function PanneauFiltre({ filtre, onFiltre }: PanneauFiltreProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  // ── Filtre courant lu depuis une ref : les effets debounces ci-dessous ne
  // doivent PAS re-declencher sur chaque changement de `filtre` (poser un
  // filtre re-lancerait le debounce, qui reposerait le meme filtre → bascule
  // « re-poser le meme le retire » de poserFiltre → le filtre s'eteindrait
  // tout seul juste apres avoir ete pose).
  const filtreRef = useRef(filtre);
  filtreRef.current = filtre;

  // ── Widget de decoupage administratif (instance LOCALE, non liee au
  // perimetre de recherche POI/bataille de FilterPanel — deux concerns
  // distincts depuis cette tache) ───────────────────────────────────────────
  const {
    scope, setScope, selectScope,
    selectedRegions, setSelectedRegions: setSelectedRegionsRaw,
    selectedDepts, setSelectedDepts: setSelectedDeptsRaw,
    ville, setVille,
    codePostal, setCodePostal,
    REF_REGIONS, availableDepts,
    territoire, hasTerritoire,
  } = useTerritorySelection({});

  const { filterSearch, sectionsOpen, toggleSection } = useFilterSections(true, null);

  const regionLabelOf = useMemo(() => {
    const m = new Map(REF_REGIONS.map(r => [r.code_region, r.nom_region]));
    return (code: string) => m.get(code) ?? code;
  }, [REF_REGIONS]);
  const deptLabelOf = useMemo(() => {
    const m = new Map(availableDepts.map(d => [d.code_dept, `${d.code_dept} — ${d.nom_dept}`]));
    return (code: string) => m.get(code) ?? code;
  }, [availableDepts]);

  // Emule une selection simple sur un widget multi-select : la region ajoutee
  // remplace la selection, une region retiree retire le filtre s'il portait
  // sur ce type. « Tout selectionner » ne compose pas un filtre par region —
  // seule la premiere region du lot resultant est retenue.
  const setSelectedRegions = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const resolved = typeof next === 'function' ? next(selectedRegions) : next;
    if (resolved.length === 0) {
      setSelectedRegionsRaw([]);
      if (filtreRef.current?.type === 'region') onFiltre(null);
      return;
    }
    const ajoutee = resolved.find(code => !selectedRegions.includes(code)) ?? resolved[0];
    setSelectedRegionsRaw([ajoutee]);
    onFiltre(poserFiltre(filtreRef.current, { type: 'region', code: ajoutee, label: regionLabelOf(ajoutee) }));
  }, [selectedRegions, setSelectedRegionsRaw, regionLabelOf, onFiltre]);

  const setSelectedDepts = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const resolved = typeof next === 'function' ? next(selectedDepts) : next;
    if (resolved.length === 0) {
      setSelectedDeptsRaw([]);
      if (filtreRef.current?.type === 'departement') onFiltre(null);
      return;
    }
    const ajoute = resolved.find(code => !selectedDepts.includes(code)) ?? resolved[0];
    setSelectedDeptsRaw([ajoute]);
    onFiltre(poserFiltre(filtreRef.current, { type: 'departement', code: ajoute, label: deptLabelOf(ajoute) }));
  }, [selectedDepts, setSelectedDeptsRaw, deptLabelOf, onFiltre]);

  // ── Recherche locale : debounce, composent un FiltreActif 'commune'/'cp' ──
  useEffect(() => {
    const trimmed = ville.trim();
    const id = setTimeout(() => {
      if (trimmed) {
        onFiltre(poserFiltre(filtreRef.current, { type: 'commune', code: trimmed.toLowerCase(), label: trimmed }));
      } else if (filtreRef.current?.type === 'commune') {
        onFiltre(null);
      }
    }, trimmed ? DEBOUNCE_MS : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtreRef evite la boucle poser/re-poser
  }, [ville]);

  useEffect(() => {
    const trimmed = codePostal.trim();
    const id = setTimeout(() => {
      if (/^\d{5}$/.test(trimmed)) {
        onFiltre(poserFiltre(filtreRef.current, { type: 'cp', code: trimmed, label: `CP ${trimmed}` }));
      } else if (!trimmed && filtreRef.current?.type === 'cp') {
        onFiltre(null);
      }
    }, trimmed ? DEBOUNCE_MS : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtreRef evite la boucle poser/re-poser
  }, [codePostal]);

  // ── Zones enregistrees : GET /api/custom-geo/list, meme contrat que
  // ZonesOverlay (components/map/overlays/ZonesOverlay.tsx). Cache useRef :
  // un seul fetch par montage du panneau (contrainte Nano). ──────────────────
  const [zones, setZones] = useState<CustomGeoZoneSummary[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const zonesFetchedRef = useRef(false);
  const [zoneSectionOpen, setZoneSectionOpen] = useState(true);

  useEffect(() => {
    if (!orgId || zonesFetchedRef.current) return;
    zonesFetchedRef.current = true;
    setZonesLoading(true);
    setZonesError(null);
    const sp = new URLSearchParams({ org_id: orgId, _t: String(Date.now()) });
    adminFetch(`/api/custom-geo/list?${sp}`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { zones: CustomGeoZoneSummary[] };
        setZones(data.zones ?? []);
      })
      .catch((e: unknown) => setZonesError(e instanceof Error ? e.message : 'Erreur de chargement'))
      .finally(() => setZonesLoading(false));
  }, [orgId]);

  const selectZone = (zone: CustomGeoZoneSummary) => {
    onFiltre(poserFiltre(filtreRef.current, {
      type: 'zone',
      code: zone.id,
      label: zone.name,
      bbox: zone.bbox ?? undefined,
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <PerimeterSections
        isOverlayMode
        filterSearch={filterSearch}
        sectionsOpen={sectionsOpen}
        toggleSection={toggleSection}
        scope={scope}
        selectScope={selectScope}
        setScope={setScope}
        selectedRegions={selectedRegions}
        setSelectedRegions={setSelectedRegions}
        refRegions={REF_REGIONS}
        selectedDepts={selectedDepts}
        setSelectedDepts={setSelectedDepts}
        availableDepts={availableDepts}
        ville={ville}
        setVille={setVille}
        codePostal={codePostal}
        setCodePostal={setCodePostal}
        territoire={territoire}
        hasTerritoire={hasTerritoire}
        adminScale={null}
        adminCodes={[]}
        territoryMaskEnabled={false}
        setTerritoryMaskEnabled={() => { /* masque territoire non branche ici — voir en-tete du fichier */ }}
      />

      {/* Filtrer sur une zone enregistree — liste dynamique, jamais en dur */}
      <div>
        <FilterSectionHeader
          label="Filtrer sur une zone enregistrée"
          sectionKey="zoneEnregistree"
          open={zoneSectionOpen}
          onToggle={() => setZoneSectionOpen(v => !v)}
          count={filtre?.type === 'zone' ? 1 : 0}
        />
        {zoneSectionOpen && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {zonesLoading && (
              <div style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Chargement…</div>
            )}
            {zonesError && (
              <div style={{ fontFamily: fInter, fontSize: 11, color: C.red }}>{zonesError}</div>
            )}
            {!zonesLoading && !zonesError && zones.length === 0 && (
              <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                Aucune zone enregistrée pour cette organisation.
              </div>
            )}
            {zones.map(zone => {
              const active = filtre?.type === 'zone' && filtre.code === zone.id;
              return (
                <button
                  key={zone.id}
                  onClick={() => selectZone(zone)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    textAlign: 'left', width: '100%',
                    padding: '8px 10px', borderRadius: 4,
                    background: active ? 'var(--brand-teal-30)' : C.bgInput,
                    border: `0.5px solid ${active ? 'var(--brand-teal)' : C.border}`,
                    color: active ? 'var(--brand-teal)' : C.text,
                    fontFamily: fInter, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  <span>{zone.name}</span>
                  <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>
                    {zone.feature_count_cp} CP · {zone.feature_count_iris} IRIS
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
