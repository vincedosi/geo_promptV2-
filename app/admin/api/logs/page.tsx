'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { C, fInter, fMono } from '../_lib/constants';
import type { DspApiLogRow } from '@/types/dsp';

export default function LogsPage() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<DspApiLogRow[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = errorsOnly ? '?level=error' : '';
      const res = await adminFetch(`/api/admin/dsp/logs${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      setLogs(json.logs ?? []);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [errorsOnly, toast]);

  useEffect(() => { load(); }, [load]);

  const levelColor = (l: string) => (l === 'error' ? C.red : l === 'warn' ? C.warn : C.textSec);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Erreurs uniquement
        </label>
        <button onClick={load} style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 12, cursor: 'pointer' }}>
          Rafraîchir
        </button>
      </div>

      {loading ? (
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</p>
      ) : logs.length === 0 ? (
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Aucun log pour le moment.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fMono, fontSize: 11 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.textDim, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px 10px' }}>Date</th>
              <th style={{ padding: '8px 10px' }}>Provider</th>
              <th style={{ padding: '8px 10px' }}>Catégorie</th>
              <th style={{ padding: '8px 10px' }}>Action</th>
              <th style={{ padding: '8px 10px' }}>Statut</th>
              <th style={{ padding: '8px 10px' }}>Durée</th>
              <th style={{ padding: '8px 10px' }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, color: C.textSec }}>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                <td style={{ padding: '8px 10px' }}>{l.provider}</td>
                <td style={{ padding: '8px 10px' }}>{l.category}</td>
                <td style={{ padding: '8px 10px' }}>{l.action}</td>
                <td style={{ padding: '8px 10px', color: levelColor(l.level) }}>{l.status_code ?? l.level}</td>
                <td style={{ padding: '8px 10px' }}>{l.duration_ms != null ? `${l.duration_ms} ms` : '—'}</td>
                <td style={{ padding: '8px 10px', color: C.text }}>{l.message ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
