'use client';

/**
 * Accordéon de liaison plateforme sous un canal sélectionné (étape Canaux,
 * UX validée 17/07) : ligne d'état repliée « Liaison — non liée ▸ » qui
 * déplie le panneau existant (cascade API Dv360LinkPanel si connecté,
 * saisie manuelle PlatformLinkPanel sinon). Le parcours budget reste léger,
 * l'état de liaison reste visible sans déplier.
 */
import { useState } from 'react';
import type { ResolvedChannel } from '@/lib/campaigns/channels';
import { linksComplete, linksSummary, type PlatformLinks } from '@/lib/campaigns/platform-links';
import { Dv360LinkPanel } from './Dv360LinkPanel';
import { PlatformLinkPanel } from './PlatformLinkPanel';
import { C, fInter, fMono } from './ui';

interface Props {
  channel: ResolvedChannel;
  campaignId: string;
  links: PlatformLinks | undefined;
  onChange: (links: PlatformLinks) => void;
}

export function ChannelLinkAccordion({ channel, campaignId, links, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const levels = channel.link_levels ?? [];
  const linked = levels.length > 0 && linksComplete(links, levels);
  const partial = !linked && !!links && Object.values(links).some((v) => (v ?? '').toString().trim() !== '');
  const summary = linksSummary(links, levels);

  const status = linked
    ? `✓ liée${summary ? ` · ${summary}` : ''}`
    : partial
      ? `liaison partielle${summary ? ` · ${summary}` : ''}`
      : 'non liée';

  return (
    <div style={{ margin: '2px 0 6px 14px', paddingLeft: 12, borderLeft: `0.5px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: fInter, fontSize: 12, color: C.textDim,
        }}
      >
        <span>Liaison</span>
        <span style={{ fontFamily: fMono, fontSize: 11, color: linked || partial ? 'var(--success)' : C.textDim }}>
          {status}
        </span>
        <span aria-hidden style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {channel.connection_provider === 'dv360' && channel.connected ? (
            <Dv360LinkPanel campaignId={campaignId} links={links} onChange={onChange} />
          ) : (
            <PlatformLinkPanel channelLabel={channel.label} levels={levels} links={links} onChange={onChange} />
          )}
        </div>
      )}
    </div>
  );
}
