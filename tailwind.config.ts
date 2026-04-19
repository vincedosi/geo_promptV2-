import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // shadcn/ui CSS variable tokens
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // ── GEOMATIK design tokens ──────────────────────────────────────────
        // Surfaces
        'geo-bg':       '#050505',
        'geo-card':     '#0a0a0a',
        'geo-elevated': '#111111',
        'geo-overlay':  '#181818',
        // Borders
        'geo-border':       '#1a1a1a',
        'geo-border-default': '#262626',
        'geo-border-hover': '#333333',
        // Text
        'geo-text':     '#f0f0f0',
        'geo-text-sec': '#a0a0a0',
        'geo-text-dim': '#666666',
        // Brand
        'geo-teal':     '#4ecdc4',
        'geo-teal-hover': '#3dbdb5',
        // Status
        'geo-success':  '#3dffa0',
        'geo-danger':   '#ff5757',
        'geo-warning':  '#f7b731',
        'geo-info':     '#5b9bd5',

        // ── Theme-backed tokens (dark/light via CSS vars) ────────────────
        'bg-primary':  'var(--bg-primary)',
        'bg-surface':  'var(--bg-surface)',
        'bg-hover':    'var(--bg-hover)',
        'bg-level-0':  'var(--bg-level-0)',
        'bg-level-1':  'var(--bg-level-1)',
        'bg-level-2':  'var(--bg-level-2)',
        'bg-level-3':  'var(--bg-level-3)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary':  'var(--text-tertiary)',
        'border-subtle':  'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-hover':   'var(--border-hover)',
        'accent-teal':    'var(--brand-teal)',
        'accent-teal-hover': 'var(--brand-teal-hover)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ["'Inter'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'monospace'],
      },
      transitionDuration: {
        DEFAULT: '150ms',
        press:   '160ms',
        hover:   '150ms',
        tooltip: '150ms',
        popover: '200ms',
        modal:   '250ms',
        drawer:  '300ms',
      },
      transitionTimingFunction: {
        // Emil Kowalski curves — override weak defaults
        DEFAULT:  'ease',
        out:      'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
        drawer:   'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
