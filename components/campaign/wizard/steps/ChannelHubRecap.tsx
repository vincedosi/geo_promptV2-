'use client';

/**
 * Mini-graph « câblage » de la campagne (étape Canaux, validé 16/07) :
 * hub central (nom + annonceur), branches MESURE / DSP / SOCIAL, état de
 * liaison par canal. Données 100% locales (draft + catalogue résolu).
 */
import type { ResolvedChannel } from '@/lib/campaigns/channels';
import { linksComplete, linksSummary } from '@/lib/campaigns/platform-links';
import type { ProgDraft } from './types';
import { C, fInter, fMono } from './ui';

interface Props { draft: ProgDraft; resolved: ResolvedChannel[] }

function Branch({ title, rows }: { title: string; rows: Array<{ code: string; label: string; linked: boolean; detail: string }> }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ flex: 1, minWidth: 150, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 8 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.code} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: fInter, fontSize: 12.5, color: C.text }}>{r.label}</div>
          <div style={{ fontFamily: fMono, fontSize: 11, color: r.linked ? 'var(--success)' : C.textDim }}>
            {r.linked ? `✓ liée${r.detail ? ` · ${r.detail}` : ''}` : '— non liée'}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelHubRecap({ draft, resolved }: Props) {
  const byCode = new Map(resolved.map((r) => [r.code, r]));
  const row = (code: string) => {
    const r = byCode.get(code);
    const levels = r?.link_levels ?? [];
    const entry = draft.channelLinks[code];
    const linked = levels.length > 0 && linksComplete(entry, levels);
    const partial = !linked && !!entry && Object.values(entry).some((v) => (v ?? '').toString().trim() !== '');
    return {
      code, label: r?.label ?? code,
      linked: linked || partial,
      detail: linksSummary(entry, levels),
    };
  };
  const mesure = draft.channels.ad_server ? [row(draft.channels.ad_server)] : [];
  const dsps = draft.channels.dsps.map(row);
  const socials = draft.channels.socials.map(row);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
      <div style={{ alignSelf: 'center', border: `0.5px solid ${C.borderDefault}`, borderRadius: 8, padding: '10px 18px', textAlign: 'center' }}>
        <div style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: C.text }}>{draft.name || 'Campagne sans nom'}</div>
        {(draft.advertiser || draft.product) && (
          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
            {[draft.advertiser, draft.product].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div aria-hidden style={{ alignSelf: 'center', width: 0.5, height: 14, background: C.borderDefault }} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Branch title="Mesure" rows={mesure} />
        <Branch title="DSP" rows={dsps} />
        <Branch title="Social" rows={socials} />
      </div>
    </div>
  );
}
