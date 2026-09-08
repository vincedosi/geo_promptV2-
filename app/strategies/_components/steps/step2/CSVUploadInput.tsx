'use client';

/**
 * Import d'un CSV `postal_code,multiplier` + histogramme de distribution des
 * multipliers chargés.
 *
 * Extrait de Step2Geography.tsx (2026-09-08), parsing et JSX inchangés.
 */

import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';

export function CSVUploadInput({ values, onChange }: { values: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (f: File) => {
    setError(null);
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      setError('CSV vide ou sans header.');
      return;
    }
    const next: Record<string, number> = {};
    let bad = 0;
    for (let i = 1; i < lines.length; i++) {
      const [cp, mul] = lines[i].split(/[,;]/).map(s => s.trim());
      const m = parseFloat(mul);
      if (cp && !Number.isNaN(m)) next[cp] = Math.max(0, Math.min(5, m));
      else bad++;
    }
    onChange(next);
    if (bad > 0) setError(`${bad} ligne(s) ignorée(s) (parsing échoué).`);
  };

  const count = Object.keys(values).length;
  // Histogramme : compte des CPs par bucket de multiplier
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0, 0, 0]; // <0.5 / 0.5-0.9 / 0.9-1.1 / 1.1-1.5 / 1.5-2 / 2-3 / 3+
    for (const m of Object.values(values)) {
      if (m < 0.5) b[0]++;
      else if (m < 0.9) b[1]++;
      else if (m < 1.1) b[2]++;
      else if (m < 1.5) b[3]++;
      else if (m < 2) b[4]++;
      else if (m < 3) b[5]++;
      else b[6]++;
    }
    const max = Math.max(...b, 1);
    return { b, max };
  }, [values]);

  return (
    <div className="flex flex-col gap-2 max-w-xl">
      <label className="flex items-center gap-2 cursor-pointer">
        <span className="px-3 py-2 rounded-md border border-border-subtle bg-bg-level-1 text-xs text-text-secondary hover:border-border-hover hover:text-text-primary flex items-center gap-2">
          <Upload className="h-4 w-4" /> Uploader un CSV
        </span>
        <input
          type="file"
          accept=".csv,.txt"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />
        {count > 0 && <span className="text-[11px] text-text-secondary">{count} CPs chargés</span>}
      </label>
      <p className="text-[11px] text-text-tertiary">
        Format : <code>postal_code,multiplier</code> (header obligatoire). Ex : <code>75001,2.5</code>
      </p>
      {error && <p className="text-[11px] text-geo-danger">{error}</p>}

      {count > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-text-tertiary mb-1">Distribution des multipliers</div>
          <div className="flex items-end gap-0.5 h-12">
            {buckets.b.map((c, i) => {
              const colors = ['#1a1a1a', '#ef4444', '#f97316', '#a0a0a0', '#7dd3c0', '#4ecdc4', '#2a9d8f'];
              return (
                <div
                  key={i}
                  title={`${c} CPs`}
                  className="flex-1 rounded-t"
                  style={{ background: colors[i], height: `${(c / buckets.max) * 100}%`, minHeight: c > 0 ? 2 : 0 }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] font-mono text-text-tertiary mt-1">
            <span>×0</span><span>×0.5</span><span>×1</span><span>×1.5</span><span>×2</span><span>×3</span><span>×5+</span>
          </div>
        </div>
      )}
    </div>
  );
}
