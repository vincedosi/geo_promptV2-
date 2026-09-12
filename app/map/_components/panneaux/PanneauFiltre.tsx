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
 * Round 1 de correction (2026-09-12) : le perimetre global (Metro/+DROM) est
 * REDEVENU un etat partage avec `FilterPanel` (props `scope`/`onScopeChange`,
 * memes `perimeterScope`/`setPerimeterScope` que `page.tsx` passe deja a
 * `FilterPanel`) — avant ce round le pill etait purement local et ne pilotait
 * plus rien, alors qu'il controle reellement le parametre `scope` envoye a
 * `/api/map/pois` par `FilterPanel.handleSearchPOI`. Region/departement/ville/CP
 * restent des etats LOCAUX (non partages) : seul le scope pilotait une requete
 * en dehors de ce panneau.
 *
 * Round 2 de correction : cliquer un pill Metro/+DROM vide deja les
 * selecteurs region/departement/ville/CP du widget (via `selectScope` de
 * `use-territory-selection.ts`, non modifie — hook partage avec `FilterPanel`)
 * mais ne le disait jamais au `FiltreActif` : le panneau affichait un
 * territoire vierge pendant que le chip, lui, continuait de borner les
 * requetes et la bataille isochrone sur le filtre resté actif. `selectScope`
 * est enveloppe ici pour retirer aussi le filtre s'il est territorial
 * (region/departement/commune/cp) — un filtre `zone` survit, il n'est pas
 * administratif. Voir `filtreApresChangementScope` (panneau-filtre-logique.ts).
 *
 * Simplifications assumees (TypeFiltre est un fichier protege, pas de valeur
 * pour un perimetre national) :
 *   - Le perimetre global (« France Metro » / « France + DROM ») ne compose
 *     PAS de `FiltreActif` (aucune valeur de `TypeFiltre` ne correspond a un
 *     scope national, et elargir la bbox sur « +DROM » violerait la regle
 *     CLAUDE.md « jamais France entiere ») — il pilote uniquement `scope`
 *     (voir ci-dessus), pas `bboxDuFiltre`.
 *   - Region / departement / commune / code postal composent un `FiltreActif`
 *     SANS bbox resolue (le referentiel regions/departements ne porte pas de
 *     bbox) : `bboxDuFiltre` replie alors sur `BBOX_METRO`, jamais une bbox
 *     plus large — comportement volontaire, jamais un elargissement. Ce
 *     `FiltreActif` n'est envoye aux fetchs de couche QUE quand il est actif
 *     (voir useMapDirectActions/useMeteoLayer/CivicHealthMapLayer) : sans lui,
 *     aucune bbox n'est ajoutee, comportement inchange.
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
 *
 * Remonter/redescendre ce panneau (ouverture/fermeture de l'`OverlayPanel`)
 * REMONTE ce composant : region/departement/ville/CP sont donc re-seedes
 * depuis `filtre` a chaque montage (effet mount-only ci-dessous), pour que le
 * widget affiche le filtre actif au lieu de sections vides.
 *
 * La logique de seed/composition (ville, code postal) est extraite dans
 * `./panneau-filtre-logique.ts`, pure et testee sans monter React —
 * voir `tests/unit/carte/panneau-filtre.test.ts`.
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
import {
  seedDepuisFiltre, composerFiltreVille, composerFiltreCodePostal, filtreApresChangementScope,
} from './panneau-filtre-logique';

type Scope = 'metro' | 'all' | null;

interface PanneauFiltreProps {
  /** Filtre actif — un seul, source unique dans `page.tsx`. */
  filtre: FiltreActif | null;
  /** Remonte le nouveau filtre (ou null) au parent. */
  onFiltre: (filtre: FiltreActif | null) => void;
  /** Perimetre global (Metro/+DROM) — PARTAGE avec `FilterPanel` (meme etat
   *  que `perimeterScope`/`setPerimeterScope` dans `page.tsx`) : c'est le
   *  parametre `scope` reellement envoye a `/api/map/pois`. */
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
}

/** Debounce recherche locale (ville/CP) : evite de composer un filtre a chaque frappe. */
const DEBOUNCE_MS = 400;

export function PanneauFiltre({ filtre, onFiltre, scope: scopeProp, onScopeChange }: PanneauFiltreProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  // ── Filtre courant lu depuis une ref : les composeurs debounces ci-dessous
  // (setVille/setCodePostal) lisent la valeur la plus recente sans redeclarer
  // leur callback a chaque changement de filtre.
  const filtreRef = useRef(filtre);
  filtreRef.current = filtre;

  // ── Widget de decoupage administratif — scope PARTAGE (props controlees),
  // region/departement/ville/CP LOCAUX (non lies au perimetre de recherche
  // POI/bataille de FilterPanel, qui derive desormais du `filtre` actif
  // directement — voir FilterPanel.tsx) ───────────────────────────────────
  const {
    scope, setScope, selectScope: selectScopeRaw,
    selectedRegions, setSelectedRegions: setSelectedRegionsRaw,
    selectedDepts, setSelectedDepts: setSelectedDeptsRaw,
    ville, setVille: setVilleRaw,
    codePostal, setCodePostal: setCodePostalRaw,
    REF_REGIONS, availableDepts,
    territoire, hasTerritoire,
  } = useTerritorySelection({ scope: scopeProp, onScopeChange });

  // ── Round 2 de correction : changer le perimetre global (pill Metro/+DROM)
  // vide deja les selecteurs region/departement/ville/CP DANS le widget
  // (selectScope de use-territory-selection.ts, non modifie — hook partage
  // avec FilterPanel, le toucher risquerait un effet de bord ailleurs) mais
  // ne le disait jamais au FiltreActif : le chip continuait de borner les
  // requetes et la bataille isochrone sur un territoire que le panneau
  // affichait pourtant comme vide. Un filtre 'zone' n'est pas territorial au
  // sens administratif : il survit au changement de perimetre.
  const selectScope = useCallback((s: 'metro' | 'all') => {
    selectScopeRaw(s);
    const next = filtreApresChangementScope(filtreRef.current);
    if (next !== filtreRef.current) onFiltre(next);
  }, [selectScopeRaw, onFiltre]);

  const { filterSearch, sectionsOpen, toggleSection } = useFilterSections(true, null);

  const regionLabelOf = useMemo(() => {
    const m = new Map(REF_REGIONS.map(r => [r.code_region, r.nom_region]));
    return (code: string) => m.get(code) ?? code;
  }, [REF_REGIONS]);
  const deptLabelOf = useMemo(() => {
    const m = new Map(availableDepts.map(d => [d.code_dept, `${d.code_dept} — ${d.nom_dept}`]));
    return (code: string) => m.get(code) ?? code;
  }, [availableDepts]);

  // ── Re-seed region/departement/ville/CP depuis le filtre actif AU MONTAGE
  // UNIQUEMENT, via la fonction pure `seedDepuisFiltre` (raw setters :
  // n'appelle jamais onFiltre — un simple affichage, pas une nouvelle
  // selection). Sans ca, rouvrir le panneau montrait des sections vides alors
  // qu'un filtre etait actif (round 1 de correction). Voir
  // tests/unit/carte/panneau-filtre.test.ts.
  useEffect(() => {
    const seed = seedDepuisFiltre(filtreRef.current);
    setVilleRaw(seed.ville);
    setCodePostalRaw(seed.codePostal);
    setSelectedRegionsRaw(seed.selectedRegions);
    setSelectedDeptsRaw(seed.selectedDepts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- montage uniquement
  }, []);

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

  // ── Recherche locale : debounce PAR SETTER (pas par useEffect keye sur la
  // valeur) — un effet remonte au montage avec l'etat local qu'il vient de
  // recevoir en seed, ce qui retirerait aussitot le filtre (bug du round 1).
  // Ici, le debounce ne se declenche QUE sur un appel explicite du setter,
  // jamais au montage : le seed ci-dessus appelle les setters RAW, qui ne
  // programment aucun debounce.
  const villeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setVille = useCallback((next: string | ((prev: string) => string)) => {
    const value = typeof next === 'function' ? (next as (p: string) => string)(ville) : next;
    setVilleRaw(value);
    if (villeTimerRef.current) clearTimeout(villeTimerRef.current);
    villeTimerRef.current = setTimeout(() => {
      onFiltre(composerFiltreVille(filtreRef.current, value));
    }, value.trim() ? DEBOUNCE_MS : 0);
  }, [ville, setVilleRaw, onFiltre]);

  const codePostalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCodePostal = useCallback((next: string) => {
    setCodePostalRaw(next);
    if (codePostalTimerRef.current) clearTimeout(codePostalTimerRef.current);
    codePostalTimerRef.current = setTimeout(() => {
      onFiltre(composerFiltreCodePostal(filtreRef.current, next));
    }, next.trim() ? DEBOUNCE_MS : 0);
  }, [setCodePostalRaw, onFiltre]);

  // Nettoyage des debounces en attente au demontage — fermer le panneau
  // n'engage pas une edition de recherche locale laissee en suspens.
  useEffect(() => () => {
    if (villeTimerRef.current) clearTimeout(villeTimerRef.current);
    if (codePostalTimerRef.current) clearTimeout(codePostalTimerRef.current);
  }, []);

  // ── Zones enregistrees : GET /api/custom-geo/list, meme contrat que
  // ZonesOverlay (components/map/overlays/ZonesOverlay.tsx). Cache useRef :
  // un seul fetch par montage du panneau (contrainte Nano). `cancelled` evite
  // un setState apres demontage (patron de CivicHealthMapLayer). ───────────
  const [zones, setZones] = useState<CustomGeoZoneSummary[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const zonesFetchedRef = useRef(false);
  const [zoneSectionOpen, setZoneSectionOpen] = useState(true);

  useEffect(() => {
    if (!orgId || zonesFetchedRef.current) return;
    zonesFetchedRef.current = true;
    let cancelled = false;
    setZonesLoading(true);
    setZonesError(null);
    const sp = new URLSearchParams({ org_id: orgId, _t: String(Date.now()) });
    adminFetch(`/api/custom-geo/list?${sp}`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { zones: CustomGeoZoneSummary[] };
        if (!cancelled) setZones(data.zones ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setZonesError(e instanceof Error ? e.message : 'Erreur de chargement');
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false);
      });
    return () => { cancelled = true; };
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
