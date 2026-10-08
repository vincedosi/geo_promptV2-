'use client';

/**
 * Étape 1/5 — Cible : le « où » et le « qui ». Catalogue d'indicateurs
 * (Audience/Comportement/Contexte) + seuil dans l'unité de l'indicateur +
 * aperçu count, OU zones de la galerie (Mes zones). Panier multi-cibles.
 * Vide = national. La pression de sur-pondération a son étape dédiée (Pression).
 * La fusion en composite se fait au Lancement (pas ici).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { buildCibleMetadata, buildCibleName, type CibleIndicator } from '@/lib/cibles/naming';
import { addCible, removeCible } from '@/lib/cibles/draft';
import { deplacer } from '@/lib/campaigns/priorite';
import type { StepProps } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, Row2, StandardFooter, StepShell } from './ui';

/** Champ texte du wizard (nom, annonceur, produit) — style commun. */
function TextInput({ value, placeholder, ariaLabel, onChange }: {
  value: string; placeholder: string; ariaLabel: string; onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
        padding: '10px 12px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13,
        color: 'var(--text-primary)', outline: 'none', transition: 'border-color 0.15s',
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-50)'; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    />
  );
}

const FAMILLES: Array<{ key: CibleIndicator['famille']; label: string }> = [
  { key: 'audience', label: 'Audience' },
  { key: 'comportement', label: 'Comportement' },
  { key: 'contexte', label: 'Contexte' },
];

interface GalleryZone { id: string; name: string; source_type: string }
interface Preview { count: number; population: number | null; scale: 'iris' | 'cp' }

export function StepCible({
  draft, setDraft, campaignId, onNext,
}: StepProps & { campaignId: string; onNext: () => void }) {
  const [indicators, setIndicators] = useState<CibleIndicator[] | null>(null);
  const [gallery, setGallery] = useState<GalleryZone[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [famille, setFamille] = useState<CibleIndicator['famille'] | 'zones'>('audience');
  const [selected, setSelected] = useState<CibleIndicator | null>(null);
  const [operator, setOperator] = useState<'>=' | '<='>('>=');
  const [threshold, setThreshold] = useState<number>(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeqRef = useRef(0);

  // Catalogue + org owner + galerie (une fois)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/api/cibles/indicators', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { indicators: [] };
        if (!cancelled) setIndicators(d.indicators ?? []);
      } catch { if (!cancelled) setIndicators([]); }
    })();
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        const org = (orgData.owner_organization_id as string | undefined) ?? null;
        if (cancelled) return;
        setOrgId(org);
        if (!org) { setGallery([]); return; }
        const res = await adminFetch(`/api/custom-geo/list?org_id=${org}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : { zones: [] };
        if (!cancelled) setGallery((data.zones ?? []) as GalleryZone[]);
      } catch { if (!cancelled) setGallery([]); }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Sélection d'un indicateur → seuil par défaut au milieu du slider
  const pickIndicator = (ind: CibleIndicator) => {
    setSelected(ind);
    setOperator(ind.default_operator);
    setThreshold((ind.slider_min + ind.slider_max) / 2);
    setPreview(null);
  };

  // Aperçu debounced (400 ms) — 1 requête COUNT par mouvement stabilisé
  useEffect(() => {
    if (!selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++previewSeqRef.current;
      try {
        const res = await adminFetch(
          `/api/cibles/preview?indicator=${encodeURIComponent(selected.indicator_code)}&operator=${encodeURIComponent(operator)}&threshold=${threshold}`,
          { cache: 'no-store' },
        );
        if (seq !== previewSeqRef.current) return; // réponse périmée — ignorer
        setPreview(res.ok ? await res.json() : null);
      } catch {
        if (seq !== previewSeqRef.current) return;
        setPreview(null);
      }
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selected, operator, threshold]);

  // Matérialiser : géométrie (route source) puis save (zone custom) puis panier
  const materialize = useCallback(async () => {
    if (!selected || !orgId || materializing) return;
    setMaterializing(true);
    setError(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/indicator-threshold', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicator_code: selected.indicator_code, operator, threshold }),
      });
      if (!geoRes.ok) {
        const j = await geoRes.json().catch(() => ({}));
        throw new Error(j.error === 'selection_too_large'
          ? 'Seuil trop large : resserre le curseur.'
          : j.error === 'empty_selection' ? 'Aucune zone ne passe ce seuil.' : `Erreur (${geoRes.status})`);
      }
      const geo = await geoRes.json();
      const name = buildCibleName(selected.label, operator, threshold, selected.unit, new Date());
      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          source_type: 'indicator_threshold',
          source_metadata: buildCibleMetadata(selected, operator, threshold, new Date()),
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée');
      if (saveRes.status === 207) {
        throw new Error('Zone créée mais résolution des codes échouée — retire-la de la galerie et réessaie.');
      }
      const saved = await saveRes.json();
      setDraft((prev) => ({
        ...prev,
        cibles: addCible(prev.cibles, {
          id: saved.zone_id, name, sourceType: 'indicator_threshold',
          indicator: {
            code: selected.indicator_code, label: selected.label,
            min: selected.slider_min, max: selected.slider_max,
          },
          population: preview?.population ?? null,
        }),
      }));
      setSelected(null);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaterializing(false);
    }
  }, [selected, orgId, operator, threshold, materializing, preview, setDraft]);

  const familyIndicators = indicators?.filter((i) => i.famille === famille) ?? [];

  return (
    <StepShell
      title="Cible"
      stepNumber={1}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Une cible = une <B>zone</B> + un <B>curseur</B> : « les zones où l&apos;indicateur dépasse (ou reste sous) le seuil que TU fixes ».</>,
          <>Tu peux en empiler plusieurs — elles fusionnent en une zone de diffusion au lancement. Panier vide = national.</>,
        ],
        tip: 'Les cibles Contexte (pollen, air) bougent chaque jour : posées en début de vague, révisables en cours de route.',
        mini: [1, 2, 3],
      }}
      footer={<StandardFooter onPrev={() => {}} isFirst nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« où »</B> : construis ta cible depuis les données, ou pioche dans tes zones. dentsu.explore
        concentre la diffusion dessus.
      </Lead>

      {/* Nom + annonceur/produit — persistés au Lancement s'ils ont changé */}
      <FieldBlock label="Nom de la campagne">
        <TextInput
          value={draft.name}
          onChange={(v) => setDraft((prev) => ({ ...prev, name: v }))}
          placeholder="Nom affiché partout (sélecteur, suivi, exports)"
          ariaLabel="Nom de la campagne"
        />
      </FieldBlock>

      <Row2>
        <FieldBlock label="Annonceur">
          <TextInput
            value={draft.advertiser}
            onChange={(v) => setDraft((prev) => ({ ...prev, advertiser: v }))}
            placeholder="Marque ou société annonceur"
            ariaLabel="Annonceur"
          />
        </FieldBlock>
        <FieldBlock label="Produit">
          <TextInput
            value={draft.product}
            onChange={(v) => setDraft((prev) => ({ ...prev, product: v }))}
            placeholder="Produit ou offre mis en avant"
            ariaLabel="Produit"
          />
        </FieldBlock>
      </Row2>

      {/* Panier */}
      <FieldBlock label={`Ma cible (${draft.cibles.length || 'national'})`}>
        {draft.cibles.length === 0 ? (
          <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
            Aucune zone cible — diffusion nationale (métropole + DROM).
          </div>
        ) : (
          /* Tache 21 : liste VERTICALE et ordonnee, plus des puces en ligne.
             Des puces qui passent a la ligne ne montrent aucun ordre, alors que
             le tableau sous-jacent en porte un.
             ⚠ L'ordre n'a AUCUN effet sur le ciblage aujourd'hui (voir la note
             sous la liste) : la fusion des cibles multiples est une union
             commutative. Il est conserve parce qu'il est le socle de la
             priorite le jour ou elle sera implementee, et parce qu'il aide a
             relire son panier.
             Le panier `draft.cibles` etant deja un tableau ordonne, le
             reordonner EST la persistance : le brouillon part tel quel dans
             `geo_strategy` au lancement.
             Aucune dependance de glisser-deposer : l'API HTML5 `draggable`
             suffit pour quelques lignes, et une bibliotheque de plus se
             paierait au chargement de /map. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {draft.cibles.map((c, index) => (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const de = Number(e.dataTransfer.getData('text/plain'));
                  setDraft((prev) => ({ ...prev, cibles: deplacer(prev.cibles, de, index) }));
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderRadius: 4, background: 'var(--brand-teal-10)',
                  border: '0.5px solid var(--brand-teal-30)',
                  fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11,
                  color: 'var(--brand-teal)', cursor: 'grab',
                }}
              >
                {/* Le rang est AFFICHE : sans lui, l'utilisateur ne sait pas
                    que l'ordre compte, ni lequel il vient de poser. */}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-tertiary)', minWidth: 12 }}>
                  {index + 1}
                </span>
                <span style={{ flex: 1 }}>{c.name}</span>
                {/* Les fleches doublent le glisser-deposer : au clavier et sur
                    tactile, `draggable` ne repond pas. */}
                <button
                  onClick={() => setDraft((prev) => ({ ...prev, cibles: deplacer(prev.cibles, index, index - 1) }))}
                  disabled={index === 0}
                  style={{ background: 'transparent', border: 'none', cursor: index === 0 ? 'default' : 'pointer', padding: 0, color: 'var(--text-tertiary)', fontSize: 11, opacity: index === 0 ? 0.3 : 1 }}
                  aria-label={`Monter ${c.name}`}
                >▲</button>
                <button
                  onClick={() => setDraft((prev) => ({ ...prev, cibles: deplacer(prev.cibles, index, index + 1) }))}
                  disabled={index === draft.cibles.length - 1}
                  style={{ background: 'transparent', border: 'none', cursor: index === draft.cibles.length - 1 ? 'default' : 'pointer', padding: 0, color: 'var(--text-tertiary)', fontSize: 11, opacity: index === draft.cibles.length - 1 ? 0.3 : 1 }}
                  aria-label={`Descendre ${c.name}`}
                >▼</button>
                <button
                  onClick={() => setDraft((prev) => ({ ...prev, cibles: removeCible(prev.cibles, c.id) }))}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1 }}
                  aria-label={`Retirer ${c.name}`}
                >×</button>
              </div>
            ))}
            {draft.cibles.length > 1 && (
              /* CORRIGE le 2026-09-13 apres relecture. Cette ligne affirmait :
                 « L'ordre decide de la priorite : la premiere zone l'emporte la
                 ou deux se recouvrent. » C'etait FAUX. `resolveFinalZone`
                 (lib/campaigns/resolve-zone.ts) fusionne les cibles multiples
                 par `/source/composite`, c'est-a-dire une UNION — qui est
                 commutative — puis applique UNE courbe d'enchere unique a toute
                 la zone. Reordonner ne changeait donc rien au ciblage pousse au
                 DSP, et un media planner qui reordonnait croyait avoir modifie
                 ses multiplicateurs sur les CP partages.
                 La priorite reste a implementer (soustraction en cascade a la
                 fusion, ou multiplicateurs resolus zone par zone). D'ici la,
                 l'ordre est un confort de lecture, et on le dit. */
              <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Ordre de lecture. Les zones multiples sont <strong>fusionnées</strong> au lancement :
                là où deux se recouvrent, la même enchère s’applique — l’ordre ne les départage
                pas encore.
              </div>
            )}
          </div>
        )}
      </FieldBlock>

      {/* Familles */}
      <FieldBlock label="Construire une cible">
        <select
          value={famille}
          onChange={(e) => { setFamille(e.target.value as CibleIndicator['famille'] | 'zones'); setSelected(null); }}
          aria-label="Type de cible"
          style={{
            width: '100%', marginBottom: 10,
            background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6,
            padding: '8px 12px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, color: 'var(--text-primary)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-50)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
        >
          {[...FAMILLES, { key: 'zones' as const, label: 'Mes zones' }].map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>

        {famille === 'zones' ? (
          <OptsList>
            {gallery === null && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement…</div>}
            {gallery?.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Aucune zone dans la galerie — crée-les depuis la carte.</div>}
            {gallery?.map((z) => (
              <OptionRow
                key={z.id}
                selected={draft.cibles.some((c) => c.id === z.id)}
                onClick={() => setDraft((prev) => ({ ...prev, cibles: addCible(prev.cibles, { id: z.id, name: z.name, sourceType: z.source_type }) }))}
                title={z.name}
                sub={z.source_type}
                value="+ ajouter"
              />
            ))}
          </OptsList>
        ) : (
          <OptsList>
            {indicators === null && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement…</div>}
            {familyIndicators.map((ind) => (
              <OptionRow
                key={ind.indicator_code}
                selected={selected?.indicator_code === ind.indicator_code}
                onClick={() => pickIndicator(ind)}
                title={ind.label}
                sub={`${ind.scale === 'iris' ? 'IRIS' : 'Code postal'} · ${ind.unit}${ind.dynamic ? ' · dynamique' : ''}`}
                value={selected?.indicator_code === ind.indicator_code ? '▼' : '▶'}
              />
            ))}
          </OptsList>
        )}
      </FieldBlock>

      {/* Seuil + aperçu + matérialiser */}
      {selected && famille !== 'zones' && (
        <FieldBlock label={`Seuil — ${selected.label}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <select value={operator} onChange={(e) => setOperator(e.target.value as '>=' | '<=')}
              style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-primary)' }}>
              <option value=">=">Au-dessus de (sur-représenté)</option>
              <option value="<=">En-dessous de (sous-représenté)</option>
            </select>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-primary)' }}>
              {threshold} {selected.unit}
            </span>
          </div>
          <input
            type="range"
            min={selected.slider_min} max={selected.slider_max} step={selected.slider_step}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--brand-teal)' }}
            aria-label={`Seuil ${selected.label}`}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-secondary)', minWidth: 220 }}>
              {previewLoading ? 'Calcul…' : preview
                ? `${preview.count.toLocaleString('fr-FR')} ${preview.scale === 'iris' ? 'IRIS' : 'CP'}${preview.population ? ` · ${Math.round(preview.population / 1000).toLocaleString('fr-FR')} k hab.` : ''}`
                : '—'}
            </span>
            <button
              onClick={() => { void materialize(); }}
              disabled={materializing || !preview || preview.count === 0 || !orgId}
              style={{
                background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
                borderRadius: 6, padding: '8px 16px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500,
                cursor: materializing || !preview || preview.count === 0 ? 'not-allowed' : 'pointer',
                opacity: materializing || !preview || preview.count === 0 ? 0.5 : 1,
              }}
            >
              {materializing ? 'Matérialisation…' : 'Ajouter à ma cible'}
            </button>
          </div>
          {error && <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--danger)' }}>{error}</div>}
          {orgId === null && gallery !== null && (
            <div style={{ marginTop: 8, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, color: 'var(--warning)' }}>
              Organisation de la campagne introuvable — la matérialisation de cibles est indisponible avec ton rôle.
            </div>
          )}
        </FieldBlock>
      )}

    </StepShell>
  );
}
