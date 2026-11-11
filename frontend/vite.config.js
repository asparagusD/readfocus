import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// D6: preload the Latin Lora and DM Sans files the first screen needs.
// Their names are hashed, so the links are added after the bundle exists.
// C13.10e adds Playfair Display: the landing page's headline (its LCP element) is set in it.
const PRELOAD_FONTS = ['playfair-display-latin-wght-normal', 'lora-latin-wght-normal', 'dm-sans-latin-wght-normal']

function preloadFonts() {
  return {
    name: 'readfocus-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {})
        return PRELOAD_FONTS.flatMap((stem) => {
          const file = files.find((f) => f.includes(`${stem}-`) && f.endsWith('.woff2'))
          if (!file) throw new Error(`preloadFonts: no bundled file for ${stem}`)
          return [{
            tag: 'link',
            attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head',
          }]
        })
      },
    },
  }
}

// C13.10e: canonical and share URLs need the site's own address, which only the deploy
// knows. With VITE_SITE_URL set (e.g. in Vercel) the build adds rel=canonical and og:url
// and makes og:image and twitter:image absolute; without it they stay relative and the
// canonical is left out rather than guessed.
function siteUrls(site) {
  return {
    name: 'readfocus-site-urls',
    transformIndexHtml(html) {
      if (!site) return html
      const base = site.replace(/\/+$/, '')
      return html
        .replaceAll('content="/og.png"', `content="${base}/og.png"`)
        .replace('</title>', `</title>\n    <link rel="canonical" href="${base}/" />\n    <meta property="og:url" content="${base}/" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), preloadFonts(), siteUrls(loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SITE_URL)],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Motion stays out of vendor so its animation features can load
          // as their own chunk after first paint (MotionRoot).
          if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return undefined;
          }
          // Only what every page needs shares the vendor chunk; the rest (charts on the
          // dashboard, for one) follows the lazy page that imports it (C13.10e).
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@supabase)[\\/]/.test(id)) {
            return 'vendor';
          }
        }
      }
    }
  }
}))
