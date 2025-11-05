import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'tablet': '1440px',  // MacBook 13" breakpoint
      },
      colors: {
        'brand-bg': '#0b1220',
        'brand-fg': '#ffffff',
      },
    },
  },
  plugins: [],
}
export default config
