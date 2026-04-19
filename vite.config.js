import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'favicon-96x96.png',
        'apple-touch-icon.png'
      ],
      manifest: {
        name: 'ROBA★STAR CAD',
        short_name: 'ROBA CAD',
        description: '図面解析・差分比較システム',
        theme_color: '#030b18',
        background_color: '#060a14',
        display: 'standalone',
        lang: 'ja',
        start_url: '/',
        icons: [
          {
            src: '/web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // pdf.js worker is ~6MB — bump limit so it's cached for offline use
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-css',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  // NOTE: pdfjs-dist 3.11.174 ships as a UMD/webpack bundle. Vite's dep
  // optimizer (esbuild) needs to pre-bundle it so `GlobalWorkerOptions`
  // and `getDocument` are exposed as proper named exports. Excluding it
  // (as the initial spec suggested) leaves the UMD wrapping intact and
  // `pdfjsLib.GlobalWorkerOptions` ends up undefined at runtime.
  optimizeDeps: {
    include: ['pdfjs-dist']
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          pdfjs: ['pdfjs-dist']
        }
      }
    }
  }
})
