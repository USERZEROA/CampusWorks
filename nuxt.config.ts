// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'CampusWorks – Office Hours Queue',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'description', content: 'Live office-hours help queue for students, TAs and instructors.' }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/campusworks-logo.svg' }]
    }
  },

  nitro: {
    externals: { inline: ['mongodb'] }
  }

  // Server settings (MONGODB_URI, SESSION_SECRET, GITLAB_*, ...) are read from
  // the environment at runtime by server/utils/config.ts, never at build time,
  // so secrets are not baked into the build output. See .env.example.
})
