'use client';

import { useState, useRef, useEffect } from 'react';

interface AISearchInputProps {
  onSearch: (categories: string[], filters: Record<string, string | string[]>) => void;
  availableCategories: string[];
  availableFilterValues: Record<string, string[]>;
  isLoading?: boolean;
}

// Pixel art robot — 10×10 grille, 3 frames
const ROBOT_FRAMES = [
  // Frame 0: idle
  [
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,1,1,2,1,1,2,1,1,0],
    [0,1,1,2,1,1,2,1,1,0],
    [0,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,3,3,1,1,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,0,0,1,1,0,0],
    [0,0,1,0,0,0,0,1,0,0],
    [0,1,1,0,0,0,0,1,1,0],
  ],
  // Frame 1: blink
  [
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,1,1,3,1,1,3,1,1,0],
    [0,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,3,3,1,1,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,0,0,0,0,1,0,0],
    [0,0,1,1,0,0,1,1,0,0],
    [0,1,1,0,0,0,0,1,1,0],
  ],
  // Frame 2: thinking (sparkles)
  [
    [0,0,0,1,1,1,1,0,4,0],
    [0,0,1,1,1,1,1,1,0,4],
    [0,1,1,2,1,1,2,1,1,0],
    [0,1,1,1,2,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,0,1,3,3,1,0,0,0],
    [0,0,1,1,0,0,1,1,0,0],
    [0,1,1,0,0,0,0,1,1,0],
    [0,1,0,0,0,0,0,0,1,0],
  ],
];

function drawRobot(ctx: CanvasRenderingContext2D, frame: number, px: number, thinking: boolean) {
  const colors: Record<number, string> = {
    0: 'transparent',
    1: thinking ? '#f59e0b' : '#6366f1',
    2: '#10b981',
    3: '#ffffff',
    4: '#fbbf24',
  };
  const robot = ROBOT_FRAMES[Math.min(frame, 2)];
  for (let y = 0; y < robot.length; y++) {
    for (let x = 0; x < robot[y].length; x++) {
      const val = robot[y][x];
      if (val === 0) continue;
      ctx.fillStyle = colors[val] || colors[1];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
}

export default function AISearchInput({
  onSearch,
  availableCategories,
  availableFilterValues,
  isLoading = false,
}: AISearchInputProps) {
  const [prompt, setPrompt] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [appliedCategories, setAppliedCategories] = useState<string[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string | string[]>>({});
  const [error, setError] = useState('');
  const [pixelFrame, setPixelFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animation robot
  useEffect(() => {
    const interval = setInterval(() => {
      setPixelFrame(prev => {
        if (isSearching) return (prev + 1) % 3;
        return prev === 0 ? (Math.random() > 0.7 ? 1 : 0) : 0;
      });
    }, isSearching ? 180 : 1500);
    return () => clearInterval(interval);
  }, [isSearching]);

  // Draw robot on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRobot(ctx, isSearching ? 2 : pixelFrame, 4, isSearching);
  }, [pixelFrame, isSearching]);

  const handleSearch = async () => {
    if (!prompt.trim() || isSearching) return;

    setIsSearching(true);
    setError('');
    setExplanation('');
    setAppliedCategories([]);
    setAppliedFilters({});

    try {
      const response = await fetch('/api/ai/parse-poi-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          availableCategories,
          availableFilterValues,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setExplanation(data.explanation || '');
        setAppliedCategories(data.categories || []);
        setAppliedFilters(data.filters || {});
        onSearch(data.categories || [], data.filters || {});
      } else {
        setError(data.error || 'Erreur de recherche');
      }
    } catch {
      setError('Erreur de connexion au service IA');
    } finally {
      setIsSearching(false);
    }
  };

  const handleReset = () => {
    setPrompt('');
    setExplanation('');
    setError('');
    setAppliedCategories([]);
    setAppliedFilters({});
    // Reset to all categories checked
    onSearch([], {});
  };

  const hasResult = explanation || appliedCategories.length > 0 || Object.keys(appliedFilters).length > 0;

  return (
    <div style={styles.container}>
      {/* Search area */}
      <div style={styles.inputWrapper}>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="lycées IDF, collèges de Brest et Quimper, CIRFA en Bretagne..."
            style={styles.input}
            disabled={isSearching}
          />
          {hasResult && !isSearching && (
            <button
              onClick={handleReset}
              title="Réinitialiser la recherche"
              style={styles.resetButton}
            >
              ✕
            </button>
          )}
          <button
            onClick={handleSearch}
            disabled={isSearching || !prompt.trim()}
            style={{
              ...styles.searchButton,
              ...(isSearching || !prompt.trim() ? styles.searchButtonDisabled : {}),
            }}
          >
            {isSearching ? <span style={styles.spinner}>⟳</span> : '🔍'}
          </button>
        </div>

        {/* Feedback */}
        {error && (
          <div style={styles.errorRow}>
            ✗ {error}
          </div>
        )}
        {explanation && !error && (
          <div style={styles.resultRow}>
            <span style={styles.explanation}>✓ {explanation}</span>
            {/* Category tags */}
            {appliedCategories.length > 0 && (
              <span style={styles.tagGroup}>
                {appliedCategories.map(c => (
                  <span key={c} style={styles.catTag}>{c}</span>
                ))}
              </span>
            )}
            {/* Filter tags */}
            {Object.entries(appliedFilters).map(([field, val]) => {
              const vals = Array.isArray(val) ? val : [val as string];
              return vals.map(v => (
                <span key={`${field}:${v}`} style={styles.filterTag}>{field}: {v}</span>
              ));
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
    borderBottom: '1px solid rgba(99, 102, 241, 0.3)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  robotBox: {
    flexShrink: 0,
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    background: 'rgba(30, 27, 75, 0.6)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
  },
  canvas: {
    imageRendering: 'pixelated',
    width: 40,
    height: 40,
  } as React.CSSProperties,
  inputWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 12,
    border: '1px solid rgba(99, 102, 241, 0.3)',
    padding: '4px 4px 4px 12px',
  },
  aiLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    padding: '4px 8px',
    background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
    borderRadius: 6,
    border: '1px solid rgba(99,102,241,0.3)',
  },
  aiText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#a5b4fc',
    letterSpacing: '0.5px',
    fontFamily: 'monospace',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e2e8f0',
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: '8px 4px',
    minWidth: 0,
  },
  resetButton: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid rgba(239,68,68,0.3)',
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    flexShrink: 0,
    width: 40,
    height: 40,
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: 'white',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
  },
  searchButtonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  spinner: {
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite',
    fontSize: 20,
  },
  errorRow: {
    padding: '2px 4px',
    fontSize: 12,
    color: '#fca5a5',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    padding: '2px 4px',
  },
  explanation: {
    fontSize: 12,
    color: '#86efac',
    fontFamily: 'Inter, system-ui, sans-serif',
    marginRight: 4,
  },
  tagGroup: {
    display: 'inline-flex',
    gap: 4,
  },
  catTag: {
    fontSize: 10,
    background: 'rgba(99,102,241,0.25)',
    color: '#a5b4fc',
    padding: '1px 7px',
    borderRadius: 3,
    border: '1px solid rgba(99,102,241,0.4)',
    fontFamily: 'monospace',
  },
  filterTag: {
    fontSize: 10,
    background: 'rgba(16,185,129,0.15)',
    color: '#6ee7b7',
    padding: '1px 7px',
    borderRadius: 3,
    border: '1px solid rgba(16,185,129,0.3)',
    fontFamily: 'monospace',
  },
};
