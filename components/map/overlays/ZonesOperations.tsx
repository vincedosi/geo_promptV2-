'use client';

/**
 * @file ZonesOperations — opérations booléennes sur les zones sélectionnées
 * (Tâche 14, 2026-09-13).
 *
 * Barre affichée au-dessus de « Mes zones » dès qu'au moins deux zones sont
 * cochées. Trois opérations, trois routes de la famille
 * `custom-geo/source/*` : Fusionner (union, route préexistante), Intersection
 * et Soustraire (écrites pour cette tâche).
 *
 * **L'ORDRE des cases cochées est signifiant, et c'est pourquoi la sélection
 * est un tableau et non un `Set`.** La soustraction n'est pas symétrique : « A
 * moins B » et « B moins A » ne donnent pas la même chose, et rien dans le
 * résultat ne dirait laquelle on a obtenue. La première zone cochée est donc
 * la base, et l'interface le dit en toutes lettres plutôt que de le laisser
 * deviner.
 *
 * **Aucune zone n'est créée à vide.** Les routes répondent 409 sur une
 * intersection ou une soustraction sans reste ; le message est affiché tel
 * quel. Enregistrer une zone à zéro code postal serait pire qu'une erreur :
 * elle partirait ensuite vers un DSP, et la campagne ne diffuserait nulle part
 * sans que rien ne l'ait signalé.
 *
 * La liste de codes postaux de la zone créée est recalculée par
 * `/api/custom-geo/save`, qui appelle déjà `resolve_custom_geo_zone_codes` —
 * il n'y a rien à refaire ici. C'est cette liste que consomme le DSP, pas la
 * géométrie.
 */
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

type Operation = 'union' | 'intersection' | 'difference';

const OPERATIONS: Record<Operation, {
  libelle: string;
  /** `source_type` de la zone créée, et route de la famille `custom-geo/source/*`. */
  source: string;
  endpoint: string;
  /** Nombre minimum de zones cochées. */
  min: number;
  aide: string;
}> = {
  union:        { libelle: 'Fusionner',    source: 'composite',    endpoint: '/api/custom-geo/source/composite',    min: 2, aide: 'tout ce que couvrent les zones cochées' },
  intersection: { libelle: 'Intersection', source: 'intersection', endpoint: '/api/custom-geo/source/intersection', min: 2, aide: 'ce que la première a en commun avec les autres' },
  difference:   { libelle: 'Soustraire',   source: 'difference',   endpoint: '/api/custom-geo/source/difference',   min: 2, aide: 'la première, moins toutes les autres' },
};

export interface ZonesOperationsProps {
  /** Ids des zones cochées, DANS L'ORDRE où elles l'ont été. */
  selection: string[];
  /** Noms, pour composer celui de la zone créée. */
  nomsParId: Map<string, string>;
  orgId: string;
  /** Vide la sélection et recharge la liste. */
  onTermine: () => void;
}

export function ZonesOperations({ selection, nomsParId, orgId, onTermine }: ZonesOperationsProps) {
  const [enCours, setEnCours] = useState<Operation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  if (selection.length === 0) return null;

  const nomDe = (id: string) => nomsParId.get(id) ?? id.slice(0, 8);

  const lancer = async (op: Operation) => {
    if (enCours || selection.length < OPERATIONS[op].min || !orgId) return;
    setEnCours(op);
    setErreur(null);
    setMessage(null);

    try {
      const cfg = OPERATIONS[op];
      const corps = op === 'difference'
        ? { zone_base: selection[0], zones_retirees: selection.slice(1) }
        : { zone_ids: selection };

      const geoRes = await adminFetch(cfg.endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      });
      const geo = await geoRes.json();

      if (!geoRes.ok) {
        // 409 = le résultat est vide. Le message de la route est déjà en
        // français et dit ce qui s'est passé : le relayer tel quel vaut mieux
        // que de le retraduire en « erreur ».
        throw new Error(
          geo.message
          ?? (geo.error === 'zone_not_found' ? 'Une des zones est introuvable.'
            : geo.error === 'zone_dupliquee' ? 'Une même zone est sélectionnée deux fois.'
            : `Erreur (${geoRes.status})`),
        );
      }

      const nom = op === 'difference'
        ? `${nomDe(selection[0])} — moins ${selection.length - 1} zone${selection.length > 2 ? 's' : ''}`
        : `${cfg.libelle} de ${selection.length} zones — ${nomDe(selection[0])}…`;

      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nom.slice(0, 200),
          source_type: cfg.source,
          // La composition est gardée en clair : sans elle, une zone issue
          // d'une opération est indiscernable d'une zone capturée, et plus
          // personne ne sait de quoi elle est faite (Tâche 15).
          source_metadata: {
            operation: op,
            member_zone_ids: selection,
            member_zone_names: selection.map(nomDe),
            surface_km2: geo.surface_km2 ?? null,
          },
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });

      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée.');
      const sauve = await saveRes.json();
      if (saveRes.status === 207) {
        throw new Error('Zone créée, mais la résolution des codes postaux a échoué — retirez-la et réessayez.');
      }

      setMessage(
        `Zone créée : ${formaterNombre(sauve.count_cp ?? 0)} code${(sauve.count_cp ?? 0) > 1 ? 's' : ''} postal`
        + `${(sauve.count_cp ?? 0) > 1 ? 'ux' : ''}`
        + (geo.surface_km2 ? ` · ${formaterNombre(geo.surface_km2)} km²` : ''),
      );
      onTermine();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
      borderRadius: 6, padding: 10, marginBottom: 10,
    }}>
      <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        {selection.length} zone{selection.length > 1 ? 's' : ''} sélectionnée{selection.length > 1 ? 's' : ''}
      </div>

      {/* La base de la soustraction est nommée, jamais laissée à deviner. */}
      {selection.length >= 2 && (
        <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
          Base : <span style={{ color: 'var(--text-primary)' }}>{nomDe(selection[0])}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(Object.keys(OPERATIONS) as Operation[]).map((op) => {
          const cfg = OPERATIONS[op];
          const inactif = selection.length < cfg.min || enCours !== null || !orgId;
          return (
            <button
              key={op}
              onClick={() => lancer(op)}
              disabled={inactif}
              title={cfg.aide}
              style={{
                flex: 1, minWidth: 92,
                background: 'transparent', border: '0.5px solid var(--brand-teal)',
                color: 'var(--brand-teal)', borderRadius: 6, padding: '7px 10px',
                fontFamily: fInter, fontSize: 11, fontWeight: 500,
                cursor: inactif ? 'not-allowed' : 'pointer', opacity: inactif ? 0.35 : 1,
              }}
            >
              {enCours === op ? '…' : cfg.libelle}
            </button>
          );
        })}
      </div>

      {selection.length < 2 && (
        <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
          Cochez au moins deux zones. L’ordre compte : la première est la base.
        </div>
      )}

      {erreur && (
        <div style={{
          marginTop: 8, padding: '7px 9px', borderRadius: 4,
          background: 'rgba(255,87,87,0.08)', border: '0.5px solid rgba(255,87,87,0.25)',
          color: 'var(--danger)', fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
        }}>{erreur}</div>
      )}
      {message && (
        <div style={{
          marginTop: 8, padding: '7px 9px', borderRadius: 4,
          background: 'rgba(61,255,160,0.08)', border: '0.5px solid rgba(61,255,160,0.2)',
          color: 'var(--success)', fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
        }}>{message}</div>
      )}
    </div>
  );
}
