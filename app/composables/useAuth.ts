// app/composables/useAuth.ts

export type AuthUser = {
  id?: string;
  email: string;
  name: string;
  primaryRole: "student" | "ta" | "instructor" | "admin";
  provider: "mock" | "gitlab";
  isGlobalAdmin: boolean;
};

/** Signed-in user, shared between server render and client. */
export const useAuthUser = () =>
  useState<AuthUser | null>("auth-user", () => null);
export const useAuthError = () => useState<string>("auth-error", () => "");

/**
 * Ask the server who is signed in. The session lives in an httpOnly cookie,
 * so useRequestFetch() is used to forward it during server-side rendering.
 */
export async function fetchAuthUser(): Promise<AuthUser | null> {
  const requestFetch = useRequestFetch();
  try {
    const res = await requestFetch<{ user: AuthUser }>("/api/auth/me");
    useAuthError().value = "";
    return res.user;
  } catch (error: any) {
    if ((error?.statusCode || error?.response?.status) === 401) return null;
    useAuthError().value = apiErrorMessage(
      error,
      "The session could not be checked. Please retry when the connection is available.",
    );
    return useAuthUser().value;
  }
}

/** End the session and return to the login page. */
export async function signOut() {
  const signingOut = useState("signing-out", () => false);
  if (signingOut.value) return;
  signingOut.value = true;
  useAuthError().value = "";
  try {
    await $fetch("/api/auth/logout", { method: "POST" });
    useAuthUser().value = null;
    await navigateTo("/login", { replace: true });
  } catch (error) {
    useAuthError().value = apiErrorMessage(
      error,
      "Sign out could not be confirmed. Your current session is still open; please retry.",
    );
  } finally {
    signingOut.value = false;
  }
}

/** Readable message from a $fetch error. */
export function apiErrorMessage(e: any, fallback: string) {
  return (
    e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback
  );
}
