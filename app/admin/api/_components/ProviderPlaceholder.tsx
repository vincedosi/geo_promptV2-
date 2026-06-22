'use client';
import { PROVIDERS, C, fInter } from '../_lib/constants';
import type { DspProvider } from '@/types/dsp';

export function ProviderPlaceholder({ providerKey }: { providerKey: DspProvider }) {
  const p = PROVIDERS.find((x) => x.key === providerKey)!;
  return (
    <div style={{ maxWidth: 560 }}>
      <img src={p.logo} alt={p.label} style={{ height: 28, marginBottom: 16 }} />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
        <p style={{ fontFamily: fInter, fontSize: 14, color: C.text, margin: 0 }}>
          Intégration {p.label} bientôt disponible
        </p>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 8 }}>
          La connexion {p.label} sera ajoutée après la mise en production de DV360.
        </p>
        <input
          disabled
          placeholder="Identifiant de compte"
          style={{ marginTop: 16, width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.textDim, fontFamily: fInter, fontSize: 13 }}
        />
      </div>
    </div>
  );
}
