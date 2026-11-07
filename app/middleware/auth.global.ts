// app/middleware/auth.global.ts

/**
 * Route guard:
 * - visitors without a session are sent to /login,
 * - signed-in users visiting /login (or /) are sent to /courses,
 * - /admin/* is reserved for global admins.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser()

  // Always re-check on /login so an expired session cannot cause a redirect loop.
  if (to.path === '/login' || !user.value) {
    user.value = await fetchAuthUser()
  }

  if (to.path === '/login') {
    return user.value ? navigateTo('/courses') : undefined
  }

  if (!user.value) {
    return navigateTo('/login')
  }

  if (to.path === '/') {
    return navigateTo('/courses')
  }

  if (to.path.startsWith('/admin') && !user.value.isGlobalAdmin) {
    return navigateTo('/courses')
  }
})
