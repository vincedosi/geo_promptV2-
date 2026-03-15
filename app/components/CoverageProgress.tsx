'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient }                from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const C = {
  bg:       '#050505',
  border:   '#261a35',
  accent:   '#a855f7',
  green:    '#3dffa0',
  amber:    '#f59e0b',
  red:      '#f87171',
  muted:    '#4b5563',
  textDim:  '#94a3b8',
  text:     '#e2e8f0',
  accentBg: 'rgba(168,85,247,0.08)',
  greenBg:  'rgba(61,255,160,0.06)',
  redBg:    'rgba(248,113,113,0.08)',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";
const fOrbitron = "'Orbitron',sans-serif";

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface BreakdownEntry {
  id:       string;
  nom:      string;
  audience: number;
}

interface CalculationJob {
  id:                 string;
  status:             JobStatus;
  progress:           number;
  result:             number | null;
  error_message:      string | null;
  poi_count:          number;
  isochrone_duration: number;
  target_column:      string;
  mode:               string;
  breakdown:          BreakdownEntry[] | null;
}

const STEPS = [
  { label: 'JOB CRÉÉ',     minProgress: 0,   minStatus: 'pending'    as JobStatus },
  { label: 'DÉMARRAGE',    minProgress: 0,   minStatus: 'processing' as JobStatus },
  { label: 'POSTGIS RPC',  minProgress: 50,  minStatus: 'processing' as JobStatus },
  { label: 'RÉSULTAT',     minProgress: 100, minStatus: 'completed'  as JobStatus },
];

const STATUS_ORDER: Record<JobStatus, number> = {
  pending: 0, processing: 1, completed: 2, failed: 2,
};

function stepDone(step: typeof STEPS[0], job: CalculationJob): boolean {
  return (
    STATUS_ORDER[job.status] > STATUS_ORDER[step.minStatus] ||
    (STATUS_ORDER[job.status] === STATUS_ORDER[step.minStatus] && job.progress >= step.minProgress)
  );
}

const METRIC_LABELS: Record<string, string> = {
  ind:       'Population totale',
  ind_18_24: '18-24 ans',
  ind_25_39: '25-39 ans',
  ind_40_54: '40-54 ans',
  ind_inc:   'Pop. inconnue',
};

export function CoverageProgress({ jobId, onClose }: {
  jobId:    string;
  onClose?: () => void;
}) {
  const [job,  setJob]  = useState<CalculationJob | null>(null);
  const [logs, setLogs] = useState<string[]>([`> [1/4] job ${jobId.slice(0, 8)}... créé`]);
  const logsRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    // Chargement initial
    sb.from('calculation_jobs')
      .select('*')
      .eq('id', jobId)
      .single()
      .then(({ data }) => {
        if (data) setJob(data as CalculationJob);
      });

    // Realtime
    const channel = sb
      .channel(`coverage-job-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calculation_jobs', filter: `id=eq.${jobId}` },
        payload => {
          const updated = payload.new as CalculationJob;
          setJob(updated);
            if (updated.status === 'processing' && updated.progress === 0) {
            addLog('> [2/4] démarrage calcul...');
          }
          if (updated.status === 'processing' && updated.progress > 0 && updated.progress < 100) {
            // Message de lot : "Lot 3/19 — 1 234 567 ind. cumulés"
            if (updated.error_message) addLog(`> ${updated.error_message}`);
          }
          if (updated.status === 'completed') {
            addLog('> [4/4] ✓ résultat disponible');
          }
          if (updated.status === 'failed') {
            addLog(`> ✕ ${updated.error_message ?? 'erreur inconnue'}`);
          }
        }
      )
      .subscribe();

    return () => { sb.removeChannel(channel); };
  }, [jobId]);

  const isRunning  = !job || job.status === 'pending' || job.status === 'processing';
  const barColor   = job?.status === 'completed' ? C.green : job?.status === 'failed' ? C.red : C.accent;
  const progress   = job?.progress ?? 0;

  return (
    <div style={{ padding: '14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.accent, letterSpacing: '0.16em' }}>
          AUDIENCE DÉDUPLIQUÉE — {METRIC_LABELS[job?.target_column ?? ''] ?? job?.target_column ?? '...'}
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: fMono, fontSize: 11, padding: 0 }}>
            ✕
          </button>
        )}
      </div>

      {/* Étapes */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {STEPS.map((s, i) => {
          const done    = job ? stepDone(s, job) : false;
          const current = job ? (
            !done &&
            (i === 0 ? job.status === 'pending' :
             i === 1 ? job.status === 'processing' && job.progress < 50 :
             i === 2 ? job.status === 'processing' && job.progress >= 50 :
             false)
          ) : false;
          return (
            <div key={s.label} style={{
              flex: 1, padding: '4px 5px', textAlign: 'center',
              background: done ? 'rgba(61,255,160,0.08)' : current ? C.accentBg : 'transparent',
              border: `1px solid ${done ? C.green : current ? C.accent : C.border}`,
              borderRadius: 2,
            }}>
              <span style={{ fontFamily: fMichroma, fontSize: 6, letterSpacing: '0.08em', color: done ? C.green : current ? C.accent : C.muted }}>
                {done ? '✓ ' : current ? '» ' : ''}{s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Barre de progression */}
      <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${progress}%`, background: barColor, borderRadius: 2,
          transition: 'width 0.6s ease, background 0.3s',
          boxShadow: isRunning ? `0 0 6px ${barColor}` : 'none',
        }} />
      </div>

      {/* Log terminal */}
      <div
        ref={logsRef}
        style={{
          maxHeight: 80, overflowY: 'auto', fontFamily: fMono, fontSize: 9,
          color: C.textDim, lineHeight: 1.7,
          scrollbarWidth: 'none',
        }}
      >
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.includes('✓') ? C.green : l.includes('✕') ? C.red : C.textDim }}>
            {l}
          </div>
        ))}
        {isRunning && (
          <div style={{ color: C.accent }}>{'> _'}</div>
        )}
      </div>

      {/* Résultat */}
      {job?.status === 'completed' && job.result != null && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: C.greenBg, border: `1px solid rgba(61,255,160,0.2)`, borderRadius: 2 }}>
          <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.green, letterSpacing: '0.14em', marginBottom: 6 }}>
            {METRIC_LABELS[job.target_column] ?? job.target_column} · {job.isochrone_duration} min · {job.mode}
          </div>
          <div style={{ fontFamily: fOrbitron, fontSize: 26, color: C.green, letterSpacing: '0.04em' }}>
            {Math.round(Number(job.result)).toLocaleString('fr-FR')}
          </div>
          <div style={{ fontFamily: fMono, fontSize: 9, color: C.textDim, marginTop: 3 }}>
            individus dans la zone de couverture dédupliquée
          </div>
        </div>
      )}

      {/* Classement par POI */}
      {job?.breakdown && job.breakdown.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.accent, letterSpacing: '0.14em', marginBottom: 6 }}>
            CLASSEMENT — {METRIC_LABELS[job.target_column] ?? job.target_column} · {job.isochrone_duration} MIN
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {job.breakdown.slice(0, 10).map((entry, i) => {
              const max = job.breakdown![0].audience;
              const pct = max > 0 ? (entry.audience / max) * 100 : 0;
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontFamily: fMono, fontSize: 8, color: C.muted, width: 14, textAlign: 'right', flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ fontFamily: fMono, fontSize: 8, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.nom}
                  </div>
                  <div style={{ width: 60, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 1, flexShrink: 0 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: C.accent, borderRadius: 1 }} />
                  </div>
                  <div style={{ fontFamily: fMono, fontSize: 8, color: C.accent, width: 52, textAlign: 'right', flexShrink: 0 }}>
                    {Math.round(entry.audience).toLocaleString('fr-FR')}
                  </div>
                </div>
              );
            })}
          </div>
          {job.breakdown.length > 10 && (
            <div style={{ fontFamily: fMono, fontSize: 8, color: C.muted, marginTop: 4 }}>
              + {job.breakdown.length - 10} autres...
            </div>
          )}
        </div>
      )}

      {/* Erreur */}
      {job?.status === 'failed' && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: C.redBg, border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 2 }}>
          <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.red, letterSpacing: '0.12em', marginBottom: 4 }}>
            ! ERREUR DE CALCUL
          </div>
          <div style={{ fontFamily: fMono, fontSize: 9, color: '#fca5a5', lineHeight: 1.6 }}>
            {job.error_message ?? 'Erreur inconnue'}
          </div>
        </div>
      )}
    </div>
  );
}
