// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'CampusWorks | TA & RA',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'description', content: 'TA and RA recruitment, appointments and course office hours.' }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/campusworks-logo.svg' }]
    }
  },

  runtimeConfig: {
    public: { demoLabel: '' }
  },

  nitro: {
    externals: { inline: ['mongodb'] }
  }

  // Server settings (MONGODB_URI, SESSION_SECRET, GITLAB_*, ...) are read from
  // the environment at runtime by server/utils/config.ts, never at build time,
  // so secrets are not baked into the build output. See .env.example.
})
