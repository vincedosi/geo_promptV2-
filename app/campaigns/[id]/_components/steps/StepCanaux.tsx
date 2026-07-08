'use client';

/**
 * Étape 2/5 — Canaux : le « où ça tourne ». DSP + réseaux sociaux (multi) +
 * ad server (unique). Filtré aux connexions de l'org ; tout dispo en démo.
 * Écrit `channels` dans le brouillon ; la persistance se fait au Lancement.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  resolveChannelAvailability, type ChannelRow, type ResolvedChannel,
} from '@/lib/campaigns/channels';
import type { StepProps } from './types';
import { B, C, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell, fInter } from './ui';

function Badge({ kind }: { kind: 'connecté' | 'démo' }) {
  const teal = kind === 'connecté';
  return (
    <span style={{
      fontFamily: fInter, fontSize: 10, padding: '2px 8px', borderRadius: 4,
      border: `0.5px solid ${teal ? C.teal : C.borderDefault}`,
      color: teal ? C.teal : C.textDim,
      background: teal ? C.tealDim : 'transparent',
    }}>{kind}</span>
  );
}

export function StepCanaux({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [catalog, setCatalog] = useState<ChannelRow[] | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        if (cancelled || !d) { if (!cancelled) setCatalog([]); return; }
        setCatalog(d.catalog ?? []);
        setConnected(d.connectedProviders ?? []);
        setIsDemo(!!d.is_demo);
        // Préremplit le brouillon depuis le stocké (une fois, si vide).
        setDraft((prev) => {
          const s = d.selected;
          const empty = prev.channels.dsps.length === 0 && prev.channels.socials.length === 0 && prev.channels.ad_server === null;
          return empty && s ? { ...prev, channels: s } : prev;
        });
      } catch { if (!cancelled) setCatalog([]); }
    })();
    return () => { cancelled = true; };
  }, [campaignId, setDraft]);

  const resolved: ResolvedChannel[] = catalog ? resolveChannelAvailability(catalog, connected, isDemo) : [];
  const avail = resolved.filter((r) => r.available);
  const dsps = avail.filter((r) => r.category === 'dsp');
  const socials = avail.filter((r) => r.category === 'social');
  const adservers = avail.filter((r) => r.category === 'adserver');

  const toggle = (list: 'dsps' | 'socials', code: string) => setDraft((prev) => {
    const cur = prev.channels[list];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    return { ...prev, channels: { ...prev.channels, [list]: next } };
  });
  const pickAdServer = (code: string) => setDraft((prev) => ({
    ...prev,
    channels: { ...prev.channels, ad_server: prev.channels.ad_server === code ? null : code },
  }));

  const emptyMsg = catalog !== null && avail.length === 0;

  return (
    <StepShell
      title="Canaux"
      stepNumber={2}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le <B>« où ça tourne »</B> : sur quels DSP et réseaux la campagne diffuse, et avec quel ad server on mesure.</>,
          <>On ne propose que les canaux <B>connectés</B> à ton organisation (tout est ouvert en démo).</>,
        ],
        tip: 'L\'ad server sert à vérifier la diffusion réelle — la boucle DSP ↔ mesure.',
        mini: [3, 2, 1],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>Déclare les plateformes de diffusion et l&apos;ad server de la campagne.</Lead>

      {catalog === null && <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Chargement…</div>}

      {emptyMsg && (
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: '12px 0' }}>
          Aucun canal connecté. Configure une connexion dans Administration → Connexions API.
        </div>
      )}

      {catalog !== null && avail.length > 0 && (
        <>
          <FieldBlock label="DSP">
            <OptsList>
              {dsps.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.dsps.includes(r.code)}
                  onClick={() => toggle('dsps', r.code)}
                  title={r.label} sub={r.category.toUpperCase()}
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {dsps.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun DSP disponible.</div>}
            </OptsList>
          </FieldBlock>

          <FieldBlock label="Réseaux sociaux">
            <OptsList>
              {socials.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.socials.includes(r.code)}
                  onClick={() => toggle('socials', r.code)}
                  title={r.label} sub="Social"
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {socials.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun réseau disponible.</div>}
            </OptsList>
          </FieldBlock>

          <FieldBlock label="Ad server (mesure)">
            <OptsList>
              {adservers.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.ad_server === r.code}
                  onClick={() => pickAdServer(r.code)}
                  title={r.label} sub="Ad server"
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {adservers.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun ad server disponible.</div>}
            </OptsList>
          </FieldBlock>
        </>
      )}
    </StepShell>
  );
}
