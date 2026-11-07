// app/composables/useAuth.ts

export type AuthUser = {
  email: string
  name: string
  primaryRole: 'student' | 'ta' | 'instructor' | 'admin'
  provider: 'mock' | 'gitlab'
  isGlobalAdmin: boolean
}

/** Signed-in user, shared between server render and client. */
export const useAuthUser = () => useState<AuthUser | null>('auth-user', () => null)

/**
 * Ask the server who is signed in. The session lives in an httpOnly cookie,
 * so useRequestFetch() is used to forward it during server-side rendering.
 */
export async function fetchAuthUser(): Promise<AuthUser | null> {
  const requestFetch = useRequestFetch()
  try {
    const res = await requestFetch<{ user: AuthUser }>('/api/auth/me')
    return res.user
  } catch {
    return null
  }
}

/** End the session and return to the login page. */
export async function signOut() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // ignore network/logout errors
  }
  useAuthUser().value = null
  await navigateTo('/login', { replace: true })
}

/** Readable message from a $fetch error. */
export function apiErrorMessage(e: any, fallback: string) {
  return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback
}
