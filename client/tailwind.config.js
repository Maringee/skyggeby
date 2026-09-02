/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#06060a',
          900: '#0a0a10',
          850: '#0e0e16',
          800: '#13131d',
          750: '#191926',
          700: '#20202f',
          600: '#2b2b3d',
          500: '#3a3a50',
        },
        blood: {
          400: '#ff5a68',
          500: '#e8263c',
          600: '#c2142a',
          700: '#8f0d1e',
        },
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#6d4df0',
          700: '#4c31b8',
        },
        steel: {
          300: '#9aa1b8',
          400: '#767e99',
          500: '#565d75',
        },
        neon: '#3ddc97',
        amber: '#f7b955',
      },
      fontFamily: {
        display: ['"Bebas Neue"', '"Oswald"', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 24px 60px -30px rgba(0,0,0,0.95)',
        glow: '0 0 24px -4px rgba(232,38,60,0.45)',
        'glow-violet': '0 0 28px -6px rgba(139,92,246,0.5)',
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        sweep: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'bar-grow': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '48%': { opacity: '1' },
          '50%': { opacity: '0.72' },
          '52%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 420ms cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 300ms ease-out both',
        sweep: 'sweep 2.8s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        'bar-grow': 'bar-grow 700ms cubic-bezier(0.22,1,0.36,1) both',
        flicker: 'flicker 6s linear infinite',
      },
    },
  },
  plugins: [],
};
