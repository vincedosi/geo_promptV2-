'use client';

/**
 * Liaison DV360 de l'étape Canaux : cascade annonceur → campagne DV360 →
 * insertion order, listée à la demande via /api/dsp/dv360/resources
 * (connexion de l'org propriétaire de la campagne). Écrit IDs + noms dans
 * `draft.channelLinks.dv360` — c'est ce que le push bidding consomme.
 *
 * Chaque niveau réinitialise les niveaux en aval quand il change.
 * S'il n'y a qu'un seul insertion order, il est présélectionné.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { Dv360Links } from '@/lib/campaigns/channels';
import { C, fInter } from './ui';

interface Item { id: string; name: string }

interface Props {
  campaignId: string;
  links: Dv360Links | undefined;
  onChange: (links: Dv360Links) => void;
}

function LinkSelect({
  label, items, value, placeholder, loading, disabled, onPick,
}: {
  label: string;
  items: Item[];
  value: string;
  placeholder: string;
  loading: boolean;
  disabled?: boolean;
  onPick: (item: Item | null) => void;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 6 }}>
        {label}
      </label>
      <select
        value={value}
        disabled={disabled || loading}
        onChange={(e) => {
          const it = items.find((i) => i.id === e.target.value) ?? null;
          onPick(it);
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
        style={{
          width: '100%', background: C.elevated,
          borderWidth: 0.5, borderStyle: 'solid', borderColor: C.border, borderRadius: 6,
          padding: '9px 10px', fontFamily: fInter, fontSize: 13,
          color: value ? C.text : C.textDim,
          outline: 'none', cursor: disabled || loading ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1, transition: 'border-color 0.15s',
        }}
      >
        <option value="">{loading ? 'Chargement…' : placeholder}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
    </div>
  );
}

export function Dv360LinkPanel({ campaignId, links, onChange }: Props) {
  const [advertisers, setAdvertisers] = useState<Item[]>([]);
  const [campaigns, setCampaigns] = useState<Item[]>([]);
  const [ios, setIos] = useState<Item[]>([]);
  const [loading, setLoading] = useState<'advertisers' | 'campaigns' | 'insertion_orders' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const advertiserId = links?.advertiser_id ?? '';
  const campaignIdDv = links?.campaign_id ?? '';
  const ioId = links?.insertion_order_id ?? '';

  const fetchLevel = useCallback(async (params: string): Promise<Item[] | null> => {
    setError(null);
    try {
      const res = await adminFetch(`/api/dsp/dv360/resources?campaignId=${encodeURIComponent(campaignId)}${params}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          d.error === 'dv360_not_connected'
            ? 'DV360 non connecté pour cette organisation (Réglages → Connexions API).'
            : (d.detail ?? d.error ?? `HTTP ${res.status}`),
        );
        return null;
      }
      return (d.items ?? []) as Item[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
      return null;
    }
  }, [campaignId]);

  // Annonceurs au montage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading('advertisers');
      const items = await fetchLevel('');
      if (!cancelled) { if (items) setAdvertisers(items); setLoading(null); }
    })();
    return () => { cancelled = true; };
  }, [fetchLevel]);

  // Campagnes quand un annonceur est choisi (y compris préchargé depuis le stocké).
  useEffect(() => {
    if (!advertiserId) { setCampaigns([]); return; }
    let cancelled = false;
    (async () => {
      setLoading('campaigns');
      const items = await fetchLevel(`&advertiserId=${encodeURIComponent(advertiserId)}`);
      if (!cancelled) { if (items) setCampaigns(items); setLoading(null); }
    })();
    return () => { cancelled = true; };
  }, [advertiserId, fetchLevel]);

  // Insertion orders quand une campagne DV360 est choisie.
  useEffect(() => {
    if (!advertiserId || !campaignIdDv) { setIos([]); return; }
    let cancelled = false;
    (async () => {
      setLoading('insertion_orders');
      const items = await fetchLevel(`&advertiserId=${encodeURIComponent(advertiserId)}&dv360CampaignId=${encodeURIComponent(campaignIdDv)}`);
      if (!cancelled) {
        if (items) {
          setIos(items);
          // Un seul IO → présélection (sans écraser un choix déjà stocké).
          if (items.length === 1 && !ioId) {
            onChange({
              ...(links ?? {}),
              insertion_order_id: items[0].id,
              insertion_order_name: items[0].name,
            });
          }
        }
        setLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relance uniquement sur changement de niveau amont
  }, [advertiserId, campaignIdDv, fetchLevel]);

  const complete = !!(advertiserId && campaignIdDv && ioId);

  return (
    <div style={{
      border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
          Liaison DV360
        </span>
        <span style={{ fontFamily: fInter, fontSize: 11, color: complete ? 'var(--success)' : C.textDim }}>
          {complete ? '✓ liée — le push bidding cible cet insertion order' : 'annonceur, campagne et insertion order'}
        </span>
      </div>

      {error && (
        <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <LinkSelect
        label="Annonceur"
        items={advertisers}
        value={advertiserId}
        placeholder="Choisir un annonceur"
        loading={loading === 'advertisers'}
        onPick={(it) => onChange(it
          ? { advertiser_id: it.id, advertiser_name: it.name }
          : {})}
      />
      <LinkSelect
        label="Campagne DV360"
        items={campaigns}
        value={campaignIdDv}
        placeholder="Choisir une campagne"
        loading={loading === 'campaigns'}
        disabled={!advertiserId}
        onPick={(it) => onChange(it
          ? { advertiser_id: advertiserId, advertiser_name: links?.advertiser_name, campaign_id: it.id, campaign_name: it.name }
          : { advertiser_id: advertiserId, advertiser_name: links?.advertiser_name })}
      />
      <LinkSelect
        label="Insertion order"
        items={ios}
        value={ioId}
        placeholder="Choisir un insertion order"
        loading={loading === 'insertion_orders'}
        disabled={!campaignIdDv}
        onPick={(it) => onChange({
          ...(links ?? {}),
          insertion_order_id: it?.id,
          insertion_order_name: it?.name,
        })}
      />
    </div>
  );
}
