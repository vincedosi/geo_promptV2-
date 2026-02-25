'use client';

import { useState, useRef, useEffect } from 'react';

interface AISearchInputProps {
  onSearch: (categories: string[], filters: Record<string, string | string[]>) => void;
  availableCategories: string[];
  availableFilterValues: Record<string, string[]>;
  isLoading?: boolean;
}

// Pixel art frames for the little robot mascot (8x8 grid)
const PIXEL_FRAMES = [
  // Frame 1: idle
  [
    '  ████  ',
    ' █░░░░█ ',
    '█░▓░░▓░█',
    '█░░░░░░█',
    '█░░██░░█',
    ' █░░░░█ ',
    '  █  █  ',
    '  █  █  ',
  ],
  // Frame 2: blink
  [
    '  ████  ',
    ' █░░░░█ ',
    '█░──░──░█',
    '█░░░░░░█',
    '█░░██░░█',
    ' █░░░░█ ',
    '  █  █  ',
    ' █    █ ',
  ],
  // Frame 3: thinking
  [
    '  ████ ★',
    ' █░░░░█ ',
    '█░▓░░▓░█',
    '█░░░░░░█',
    '█░░▬▬░░█',
    ' █░░░░█ ',
    ' █    █ ',
    '  █  █  ',
  ],
];

export default function AISearchInput({
  onSearch,
  availableCategories,
  availableFilterValues,
  isLoading = false,
}: AISearchInputProps) {
  const [prompt, setPrompt] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [pixelFrame, setPixelFrame] = useState(0);
  const [showPixelArt, setShowPixelArt] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pixel art animation cycle
  useEffect(() => {
    if (isSearching) {
      // Fast animation when searching
      const interval = setInterval(() => {
        setPixelFrame(prev => (prev + 1) % 3);
      }, 200);
      return () => clearInterval(interval);
    } else {
      // Slow idle blink
      const interval = setInterval(() => {
        setPixelFrame(prev => {
          if (prev === 0) return Math.random() > 0.7 ? 1 : 0; // occasional blink
          return 0;
        });
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [isSearching]);

  const handleSearch = async () => {
    if (!prompt.trim() || isSearching) return;

    setIsSearching(true);
    setError('');
    setExplanation('');
    setPixelFrame(2); // thinking face

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
        onSearch(data.categories || [], data.filters || {});
      } else {
        setError(data.error || 'Erreur de recherche');
      }
    } catch (err) {
      setError('Erreur de connexion');
      console.error('[AISearchInput] Error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div style={styles.container}>
      {/* Pixel Art Robot */}
      {showPixelArt && (
        <div style={styles.pixelArtContainer}>
          <canvas
            ref={(canvas) => {
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              const size = 4;
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // Draw pixel robot
              const frame = isSearching ? 2 : pixelFrame;
              drawPixelRobot(ctx, frame, size, isSearching);
            }}
            width={48}
            height={48}
            style={styles.pixelCanvas}
          />
        </div>
      )}

      {/* Search Input Area */}
      <div style={styles.inputWrapper}>
        <div style={styles.inputRow}>
          <div style={styles.aiLabel}>
            <span style={styles.aiIcon}>✨</span>
            <span style={styles.aiText}>GEO.AI</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="lycées de Brest et Toulon, collèges en Bretagne..."
            style={styles.input}
            disabled={isSearching}
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !prompt.trim()}
            style={{
              ...styles.searchButton,
              ...(isSearching ? styles.searchButtonDisabled : {}),
              ...(!prompt.trim() && !isSearching ? styles.searchButtonEmpty : {}),
            }}
          >
            {isSearching ? (
              <span style={styles.spinner}>⟳</span>
            ) : (
              '🔍'
            )}
          </button>
        </div>

        {/* Feedback row */}
        {(explanation || error) && (
          <div style={styles.feedbackRow}>
            {explanation && (
              <span style={styles.explanation}>✓ {explanation}</span>
            )}
            {error && (
              <span style={styles.error}>✗ {error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Draw a pixel art robot on canvas
 */
function drawPixelRobot(ctx: CanvasRenderingContext2D, frame: number, px: number, isSearching: boolean) {
  const colors = {
    body: isSearching ? '#f59e0b' : '#3b82f6',
    eye: '#10b981',
    mouth: '#ffffff',
    bg: 'transparent',
    highlight: '#60a5fa',
    star: '#f59e0b',
  };

  // Simple 10x10 pixel robot
  const robots = [
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
    // Frame 2: thinking (with sparkles)
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

  const robot = robots[Math.min(frame, 2)];
  const colorMap: Record<number, string> = {
    0: colors.bg,
    1: colors.body,
    2: colors.eye,
    3: colors.mouth,
    4: colors.star,
  };

  for (let y = 0; y < robot.length; y++) {
    for (let x = 0; x < robot[y].length; x++) {
      const val = robot[y][x];
      if (val === 0) continue;
      ctx.fillStyle = colorMap[val] || colors.body;
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
    borderBottom: '1px solid rgba(99, 102, 241, 0.3)',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(99, 102, 241, 0.1)',
    position: 'relative',
    zIndex: 10,
  },
  pixelArtContainer: {
    flexShrink: 0,
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    background: 'rgba(30, 27, 75, 0.6)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
  },
  pixelCanvas: {
    imageRendering: 'pixelated' as any,
    width: '40px',
    height: '40px',
  },
  inputWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(15, 23, 42, 0.8)',
    borderRadius: '12px',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    padding: '4px 4px 4px 12px',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  aiLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    padding: '4px 8px',
    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2))',
    borderRadius: '6px',
    border: '1px solid rgba(99, 102, 241, 0.3)',
  },
  aiIcon: {
    fontSize: '14px',
  },
  aiText: {
    fontSize: '11px',
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
    fontSize: '14px',
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: '8px 4px',
    minWidth: 0,
  },
  searchButton: {
    flexShrink: 0,
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: 'white',
    fontSize: '18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.15s, box-shadow 0.15s',
    boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
  },
  searchButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  searchButtonEmpty: {
    opacity: 0.4,
    cursor: 'default',
  },
  spinner: {
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite',
    fontSize: '20px',
  },
  feedbackRow: {
    padding: '0 4px',
    minHeight: '18px',
  },
  explanation: {
    fontSize: '12px',
    color: '#86efac',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  error: {
    fontSize: '12px',
    color: '#fca5a5',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
};
