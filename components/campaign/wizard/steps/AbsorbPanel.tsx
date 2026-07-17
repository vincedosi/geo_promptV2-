'use client';

/**
 * Rattachement d'un import orphelin (étape Canaux, sous « Liaisons plateformes »,
 * visible si un ad server est sélectionné) : les données Adform arrivées AVANT
 * le lancement du wizard ont créé une campagne « coquille » — ce panel liste les
 * imports de l'org sans stratégie de bidding et fusionne l'un d'eux dans la
 * campagne courante (`POST /absorb`). Fusion irréversible (coquille source
 * supprimée) : confirmation via `ConfirmModal` avant tout appel réseau.
 */
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { C, fInter, fMono } from './ui';

interface AttachableCampaign {
  id: string;
  name: string;
  dsp_source: string | null;
  rows: number;
}

export function AbsorbPanel({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AttachableCampaign[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<AttachableCampaign | null>(null);

  const load = async () => {
    setOpen(true);
    const res = await adminFetch(`/api/admin/campaigns/attachable?exclude=${campaignId}`, { cache: 'no-store' });
    const d = res.ok ? await res.json() : { campaigns: [] };
    setList(d.campaigns ?? []);
  };

  const absorb = async (sourceId: string, name: string) => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${campaignId}/absorb`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_campaign_id: sourceId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setDone(`${d.moved ?? 0} lignes rattachées depuis « ${name} »`); setOpen(false); }
      else if (d.error === 'target_has_data') setDone('Cette campagne a déjà des données — rattachement impossible.');
      else setDone(`Échec : ${d.error ?? res.status}`);
    } finally { setBusy(false); setPending(null); }
  };

  return (
    <div style={{ marginTop: 10 }}>
      {!open && (
        <button type="button" onClick={() => { void load(); }}
          style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '7px 12px', fontFamily: fInter, fontSize: 12, cursor: 'pointer' }}>
          Rattacher un import existant
        </button>
      )}
      {open && (
        <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list === null && <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Chargement…</span>}
          {list?.length === 0 && <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun import non programmé dans ton organisation.</span>}
          {list?.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontFamily: fInter, fontSize: 12.5, color: C.text }}>{c.name}</span>
              <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>{c.dsp_source} · {c.rows.toLocaleString('fr-FR')} lignes</span>
              <button type="button" disabled={busy} onClick={() => setPending(c)}
                style={{ background: 'transparent', border: `0.5px solid ${C.teal}`, color: C.teal, borderRadius: 6, padding: '5px 10px', fontFamily: fInter, fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer' }}>
                Rattacher
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setOpen(false)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: C.textDim, fontFamily: fInter, fontSize: 11, cursor: 'pointer', padding: 0 }}>Fermer</button>
        </div>
      )}
      {done && <div style={{ marginTop: 6, fontFamily: fInter, fontSize: 12, color: C.textSec }}>{done}</div>}

      <ConfirmModal
        open={pending !== null}
        onClose={() => { if (!busy) setPending(null); }}
        onConfirm={() => { if (pending) void absorb(pending.id, pending.name); }}
        title="Rattacher cet import ?"
        message={pending ? `Les données de « ${pending.name} » seront déplacées vers cette campagne. L'import source sera supprimé — action irréversible.` : ''}
        confirmLabel="Rattacher"
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
