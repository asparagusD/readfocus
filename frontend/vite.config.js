import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// D6: preload the Latin Lora and DM Sans files the first screen needs.
// Their names are hashed, so the links are added after the bundle exists.
const PRELOAD_FONTS = ['lora-latin-wght-normal', 'dm-sans-latin-wght-normal']

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
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
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
})
