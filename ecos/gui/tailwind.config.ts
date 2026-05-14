import type { Config } from 'tailwindcss'

export default {
  content: [
    './apps/renderer/index.html',
    './apps/renderer/src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {}
  },
  plugins: []
} satisfies Config
