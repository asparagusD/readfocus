import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { checkDeployEnv, isVercelBuild } from './src/deploy/deployEnv.js'
import { contentSecurityPolicy, inlineScriptHashes } from './src/deploy/csp.js'

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

// C14.2: a Vercel build stops when a VITE_ variable is missing or wrong, instead of
// shipping a bundle that talks to localhost or the dev Supabase project.
function deployEnv() {
  return {
    name: 'readfocus-deploy-env',
    apply: 'build',
    config(_config, { mode }) {
      const env = loadEnv(mode, import.meta.dirname, '') // '' = every variable, VERCEL included
      if (mode !== 'production' || !isVercelBuild(env)) return
      const { errors, warnings } = checkDeployEnv(env)
      warnings.forEach((line) => console.warn(`deploy env: ${line}`))
      if (errors.length) throw new Error(`deploy env:\n- ${errors.join('\n- ')}\nSet them in Vercel, Settings > Environment Variables.`)
    },
  }
}

// C17.2: PDF.js fetches fonts a PDF does not embed and its JPEG 2000 / JBIG2 image
// decoders (wasm) at run time. They are served from /pdfjs/ on our own origin: from
// node_modules in dev, copied into the build otherwise. Only an open PDF asks for them.
const PDFJS_DIRS = ['standard_fonts', 'wasm', 'iccs']
const PDFJS_ROOT = join(import.meta.dirname, 'node_modules', 'pdfjs-dist')
// Not served: the JS fallbacks (the wasm decoders are used) and quickjs-eval, which runs
// JavaScript embedded in a PDF. Licence files ship with what they cover.
const servable = (name) => !name.startsWith('quickjs') && !name.endsWith('.js')

function pdfjsAssets() {
  return {
    name: 'readfocus-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [dir, ...rest] = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').filter(Boolean)
        const file = join(PDFJS_ROOT, dir ?? '', ...rest)
        if (!PDFJS_DIRS.includes(dir) || rest.length !== 1 || /^\.\.?$|\\/.test(rest[0]) || !servable(rest[0]) || !existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of readdirSync(join(PDFJS_ROOT, dir))) {
          if (!servable(name)) continue
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS_ROOT, dir, name)) })
        }
      }
      this.emitFile({ type: 'asset', fileName: 'pdfjs/LICENSE', source: readFileSync(join(PDFJS_ROOT, 'LICENSE')) })
    },
  }
}

// C17.3: the Content-Security-Policy as the first <meta> in the built page, with the
// inline theme script allowed by its hash and the API and Supabase origins from the
// build's own env (src/deploy/csp.js). Dev has none: Vite's HMR needs inline code.
function contentSecurityPolicyMeta(env) {
  return {
    name: 'readfocus-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = contentSecurityPolicy({
          apiUrl: env.VITE_API_URL || 'http://localhost:8000',
          supabaseUrl: env.VITE_SUPABASE_URL || 'https://lvfhuszvuiowyeizstru.supabase.co',
          scriptHashes: inlineScriptHashes(html),
        })
        return html.replace(/<head>/i, `<head>
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [deployEnv(), react(), tailwindcss(), preloadFonts(), pdfjsAssets(), siteUrls(loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SITE_URL),
    contentSecurityPolicyMeta(loadEnv(mode, import.meta.dirname, 'VITE_'))],
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
