import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/tv-recommendations/',

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'TV Recommendations',
        short_name: 'TV Rec',
        description: 'Personal TV recommendations and viewing feedback',

        theme_color: '#10131a',
        background_color: '#10131a',

        display: 'standalone',
        start_url: '/tv-recommendations/',
        scope: '/tv-recommendations/',

        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})
