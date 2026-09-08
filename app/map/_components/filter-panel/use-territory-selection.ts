/**
 * @file filter-panel/use-territory-selection.ts — perimetre territorial
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Regroupe quatre blocs qui etaient
 * disperses dans le composant : l'etat du perimetre, le referentiel geo, la
 * cascade regions -> departements et la phrase de territoire.
 *
 * Controlled / uncontrolled : chaque champ suit la prop si elle est fournie,
 * sinon un state interne. Le lift vers map/page.tsx sert la persistance entre
 * fermeture et reouverture des overlays — les analyses doivent voir les filtres
 * territoriaux courants meme apres un demontage du panneau.
 *
 * Les codes manipules sont les VRAIS codes INSEE (ref_regions.code_region,
 * ref_departements.code_dept) et sont envoyes tels quels aux RPC. Ne jamais
 * revenir a des ids applicatifs ('bre', 'ara') : ils ne matchaient aucune RPC.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRefGeo } from '@/lib/geo/use-ref-geo';

type Scope = 'metro' | 'all' | null;

export interface TerritorySelectionProps {
  scope?: Scope;
  onScopeChange?: (scope: Scope) => void;
  selectedRegions?: string[];
  onSelectedRegionsChange?: (regions: string[]) => void;
  selectedDepts?: string[];
  onSelectedDeptsChange?: (depts: string[]) => void;
  ville?: string;
  onVilleChange?: (ville: string) => void;
}

export function useTerritorySelection({
  scope: scopeProp, onScopeChange,
  selectedRegions: selectedRegionsProp, onSelectedRegionsChange,
  selectedDepts: selectedDeptsProp, onSelectedDeptsChange,
  ville: villeProp, onVilleChange,
}: TerritorySelectionProps) {
  // ── Territoire state ──────────────────────────────────────────────────────
  // Controlled si props fournies (lift à page.tsx pour persistance entre
  // fermeture/réouverture des overlays — les analyses doivent voir les
  // filtres territoriaux courants), sinon fallback uncontrolled.
  const [internalScope,           setInternalScope]           = useState<'metro' | 'all' | null>(null);
  const [internalSelectedRegions, setInternalSelectedRegions] = useState<string[]>([]);
  const [internalSelectedDepts,   setInternalSelectedDepts]   = useState<string[]>([]);
  const [internalVille,           setInternalVille]           = useState('');

  const scope           = scopeProp           !== undefined ? scopeProp           : internalScope;
  const selectedRegions = selectedRegionsProp !== undefined ? selectedRegionsProp : internalSelectedRegions;
  const selectedDepts   = selectedDeptsProp   !== undefined ? selectedDeptsProp   : internalSelectedDepts;
  const ville           = villeProp           !== undefined ? villeProp           : internalVille;

  const setScope = useCallback((next: 'metro' | 'all' | null | ((prev: 'metro' | 'all' | null) => 'metro' | 'all' | null)) => {
    const value = typeof next === 'function' ? (next as (p: 'metro' | 'all' | null) => 'metro' | 'all' | null)(scope) : next;
    if (onScopeChange) onScopeChange(value);
    else setInternalScope(value);
  }, [scope, onScopeChange]);

  const setSelectedRegions = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function' ? (next as (p: string[]) => string[])(selectedRegions) : next;
    if (onSelectedRegionsChange) onSelectedRegionsChange(value);
    else setInternalSelectedRegions(value);
  }, [selectedRegions, onSelectedRegionsChange]);

  const setSelectedDepts = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    const value = typeof next === 'function' ? (next as (p: string[]) => string[])(selectedDepts) : next;
    if (onSelectedDeptsChange) onSelectedDeptsChange(value);
    else setInternalSelectedDepts(value);
  }, [selectedDepts, onSelectedDeptsChange]);

  const setVille = useCallback((next: string | ((prev: string) => string)) => {
    const value = typeof next === 'function' ? (next as (p: string) => string)(ville) : next;
    if (onVilleChange) onVilleChange(value);
    else setInternalVille(value);
  }, [ville, onVilleChange]);
  const [codePostal,      setCodePostal]      = useState('');

  // ── Données géographiques DB (ref_regions / ref_departements) ─────────────
  // Source unique de vérité : codes INSEE ('53' Bretagne, '84' ARA, etc.).
  // Pendant le 1er mount (fetch en cours), les listes sont vides — loading
  // propre, la MultiDropdown affiche "Aucun résultat" jusqu'au cache hit.
  const { data: refGeo, allDepts: REF_ALL_DEPTS } = useRefGeo();
  const REF_REGIONS = useMemo(() => refGeo?.regions ?? [], [refGeo]);

  // ── Geographic cascade ────────────────────────────────────────────────────
  // Cascade : si des régions sont sélectionnées, on limite les départements
  // aux depts de ces régions. Sinon tous les départements (attention : tant
  // que refGeo n'est pas chargé, REF_ALL_DEPTS est [] → la liste apparaît
  // vide le temps du 1er fetch, puis se remplit au cache hit).
  const availableDepts = useMemo(() =>
    selectedRegions.length === 0 ? REF_ALL_DEPTS
      : REF_REGIONS.filter(r => selectedRegions.includes(r.code_region)).flatMap(r => r.depts),
    [selectedRegions, REF_ALL_DEPTS, REF_REGIONS],
  );
  useEffect(() => {
    // Ne jamais purger la sélection si la cascade n'est pas encore chargée
    // (sinon on perd la sélection user pendant le 1er fetch).
    if (availableDepts.length === 0 && REF_ALL_DEPTS.length === 0) return;
    const codes = availableDepts.map(d => d.code_dept);
    // Bail-out référentiel : renvoyer prev tel quel si rien n'est purgé,
    // sinon setState reçoit un nouveau tableau à chaque passage → boucle infinie.
    setSelectedDepts(prev => {
      const next = prev.filter(d => codes.includes(d));
      return next.length === prev.length ? prev : next;
    });
  }, [availableDepts, REF_ALL_DEPTS]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectScope = (s: 'metro' | 'all') => {
    setScope(prev => prev === s ? null : s);
    setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal('');
  };

  // ── Territoire helpers ────────────────────────────────────────────────────
  const buildTerritoire = (): string => {
    if (ville.trim()) return `à ${ville.trim()}${codePostal ? ` (${codePostal})` : ''}`;
    if (selectedDepts.length === 1) {
      const d = REF_ALL_DEPTS.find(x => x.code_dept === selectedDepts[0]);
      return `dans le département ${selectedDepts[0]}${d ? ` — ${d.nom_dept}` : ''}`;
    }
    if (selectedDepts.length > 1) return `dans les départements ${selectedDepts.join(', ')}`;
    if (selectedRegions.length === 1) {
      const r = REF_REGIONS.find(x => x.code_region === selectedRegions[0]);
      return `en ${r?.nom_region ?? selectedRegions[0]}`;
    }
    if (selectedRegions.length > 1) {
      const names = selectedRegions.map(code => REF_REGIONS.find(r => r.code_region === code)?.nom_region ?? code);
      return `en ${names.join(' et ')}`;
    }
    if (scope === 'metro') return 'de France métropolitaine';
    if (scope === 'all')   return 'de France entière';
    return 'de France';
  };

  const territoire    = buildTerritoire();
  const hasTerritoire = scope !== null || selectedRegions.length > 0 || selectedDepts.length > 0 || ville.trim().length > 0;

  return {
    scope, setScope, selectScope,
    selectedRegions, setSelectedRegions,
    selectedDepts, setSelectedDepts,
    ville, setVille,
    codePostal, setCodePostal,
    REF_REGIONS, REF_ALL_DEPTS, availableDepts,
    territoire, hasTerritoire,
  };
}
