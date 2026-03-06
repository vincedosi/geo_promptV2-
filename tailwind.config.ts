import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#a855f7',
        'background-dark': '#050505',
        'terminal-gray': '#121212',
        'border-accent': '#261a35',
      },
      fontFamily: {
        display: ["'Orbitron'", 'sans-serif'],
        geometric: ["'Michroma'", 'sans-serif'],
        sans: ["'Inter'", 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
