'use client';

/**
 * Étape 2/5 — Canaux & budgets : le « où ça tourne » et le « combien par canal ».
 * DSP + réseaux sociaux (multi) + ad server (unique), filtrés aux connexions de
 * l'org (tout dispo en démo). Chaque canal sélectionné porte SA ligne de budget
 * en face de lui — budget global = somme en lecture seule — plus la période.
 * Écrit `channels`, `channelBudgets`, `startDate`, `endDate` dans le brouillon ;
 * la persistance se fait au Lancement.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  resolveChannelAvailability, type ChannelRow, type ResolvedChannel, type StoredChannels,
} from '@/lib/campaigns/channels';
import type { StepProps } from './types';
import { draftTotalBudget, fmtEUR } from './types';
import type { PlatformLinks } from '@/lib/campaigns/platform-links';
import { Dv360LinkPanel } from './Dv360LinkPanel';
import { PlatformLinkPanel } from './PlatformLinkPanel';
import { AbsorbPanel } from './AbsorbPanel';
import { B, C, DateField, FieldBlock, Lead, OptionRow, OptsList, Row2, StandardFooter, StepShell, fInter, fMono } from './ui';

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

/**
 * Champ budget inline dans la ligne de canal — stoppe la propagation pour que
 * cliquer/taper dans le champ ne désélectionne pas le canal (OptionRow radio).
 */
function RowBudgetInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <input
        type="number"
        min={0}
        step={100}
        value={value ?? ''}
        placeholder="budget"
        aria-label="Budget du canal (€)"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
        style={{
          width: 110, background: C.elevated,
          borderWidth: 0.5, borderStyle: 'solid', borderColor: C.border, borderRadius: 6,
          padding: '6px 8px', fontFamily: fMono, fontSize: 13, color: C.text,
          outline: 'none', textAlign: 'right', transition: 'border-color 0.15s',
        }}
      />
      <span style={{ fontFamily: fMono, fontSize: 12, color: C.textDim }}>€</span>
    </span>
  );
}

export function StepCanaux({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [catalog, setCatalog] = useState<ChannelRow[] | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const prefilledRef = useRef(false);

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
        // Préremplit le brouillon depuis le stocké (une fois, si vide) :
        // canaux sélectionnés ET lignes de budget (reprogrammation).
        if (!prefilledRef.current) {
          prefilledRef.current = true;
          const s = d.selected as StoredChannels | undefined;
          setDraft((prev) => {
            const emptyChannels = prev.channels.dsps.length === 0 && prev.channels.socials.length === 0 && prev.channels.ad_server === null;
            const emptyBudgets = Object.keys(prev.channelBudgets).length === 0;
            const emptyLinks = Object.keys(prev.channelLinks).length === 0;
            if (!s || (!emptyChannels && !emptyBudgets && !emptyLinks)) return prev;
            return {
              ...prev,
              channels: emptyChannels ? { dsps: s.dsps ?? [], socials: s.socials ?? [], ad_server: s.ad_server ?? null } : prev.channels,
              channelBudgets: emptyBudgets ? { ...(s.budgets ?? {}) } : prev.channelBudgets,
              channelLinks: emptyLinks ? { ...(s.links ?? {}) } : prev.channelLinks,
            };
          });
        }
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
  const setBudget = (code: string, v: number | null) => setDraft((prev) => {
    const next = { ...prev.channelBudgets };
    if (v == null) delete next[code]; else next[code] = v;
    return { ...prev, channelBudgets: next };
  });
  const setLinks = (code: string, entry: PlatformLinks) => setDraft((prev) => ({
    ...prev, channelLinks: { ...prev.channelLinks, [code]: entry },
  }));

  const emptyMsg = catalog !== null && avail.length === 0;
  const total = draftTotalBudget(draft);
  const hasSelection = draft.channels.dsps.length > 0 || draft.channels.socials.length > 0;
  const nextDisabled = !hasSelection || !total || !draft.startDate || !draft.endDate;

  return (
    <StepShell
      title="Canaux & budgets"
      stepNumber={2}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le <B>« où ça tourne »</B> et le <B>« combien »</B> : chaque canal sélectionné porte sa ligne de budget. Le global n&apos;est que la somme.</>,
          <>On ne propose que les canaux <B>connectés</B> à ton organisation (tout est ouvert en démo).</>,
        ],
        tip: 'L\'ad server sert à vérifier la diffusion réelle — la boucle DSP ↔ mesure.',
        mini: [3, 2, 1],
      }}
      footer={
        <StandardFooter
          onPrev={onPrev}
          nextLabel="Continuer →"
          onNext={onNext}
          nextDisabled={nextDisabled}
          hint={nextDisabled ? 'canal + budget + période requis' : undefined}
        />
      }
    >
      <Lead>
        Déclare les plateformes de diffusion, le budget de chacune et la période. MAGELIAN pace la dépense pour ne jamais dépasser.
      </Lead>

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
              {dsps.map((r) => {
                const selected = draft.channels.dsps.includes(r.code);
                return (
                  <OptionRow key={r.code}
                    selected={selected}
                    onClick={() => toggle('dsps', r.code)}
                    title={r.label} sub={r.category.toUpperCase()}
                    value={selected
                      ? <RowBudgetInput value={draft.channelBudgets[r.code] ?? null} onChange={(v) => setBudget(r.code, v)} />
                      : <Badge kind={r.connected ? 'connecté' : 'démo'} />} />
                );
              })}
              {dsps.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun DSP disponible.</div>}
            </OptsList>
          </FieldBlock>

          <FieldBlock label="Réseaux sociaux">
            <OptsList>
              {socials.map((r) => {
                const selected = draft.channels.socials.includes(r.code);
                return (
                  <OptionRow key={r.code}
                    selected={selected}
                    onClick={() => toggle('socials', r.code)}
                    title={r.label} sub="Social"
                    value={selected
                      ? <RowBudgetInput value={draft.channelBudgets[r.code] ?? null} onChange={(v) => setBudget(r.code, v)} />
                      : <Badge kind={r.connected ? 'connecté' : 'démo'} />} />
                );
              })}
              {socials.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun réseau disponible.</div>}
            </OptsList>
          </FieldBlock>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: `0.5px solid ${C.border}`, padding: '10px 2px 0', marginBottom: 18,
          }}>
            <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>Budget global (somme)</span>
            <span style={{ fontFamily: fMono, fontSize: 15, color: C.text }}>{fmtEUR(total)}</span>
          </div>

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

          {/* Liaisons plateformes — un panel par canal sélectionné dont le registre
              définit des niveaux : cascade API si la connexion de l'org sait lister
              (DV360), saisie manuelle Nom + ID sinon (démo / connexion absente).
              Même structure channelLinks[code] dans les deux cas. */}
          {(() => {
            const selectedCodes = [
              ...draft.channels.dsps, ...draft.channels.socials,
              ...(draft.channels.ad_server ? [draft.channels.ad_server] : []),
            ];
            const linkable = resolved.filter(
              (r) => selectedCodes.includes(r.code) && (r.link_levels?.length ?? 0) > 0,
            );
            if (linkable.length === 0) return null;
            return (
              <FieldBlock label="Liaisons plateformes (optionnel)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {linkable.map((r) => (
                    r.connection_provider === 'dv360' && r.connected ? (
                      <Dv360LinkPanel
                        key={r.code}
                        campaignId={campaignId}
                        links={draft.channelLinks[r.code]}
                        onChange={(entry) => setLinks(r.code, entry)}
                      />
                    ) : (
                      <PlatformLinkPanel
                        key={r.code}
                        channelLabel={r.label}
                        levels={r.link_levels ?? []}
                        links={draft.channelLinks[r.code]}
                        onChange={(entry) => setLinks(r.code, entry)}
                      />
                    )
                  ))}
                </div>
              </FieldBlock>
            );
          })()}

          {draft.channels.ad_server && <AbsorbPanel campaignId={campaignId} />}

          <FieldBlock label="Période">
            <Row2>
              <DateField label="Début" value={draft.startDate} onChange={(v) => setDraft((prev) => ({ ...prev, startDate: v }))} />
              <DateField label="Fin" value={draft.endDate} onChange={(v) => setDraft((prev) => ({ ...prev, endDate: v }))} />
            </Row2>
          </FieldBlock>
        </>
      )}
    </StepShell>
  );
}
