// app/middleware/auth.global.ts

/**
 * Route guard:
 * - visitors without a session are sent to /login,
 * - signed-in users visiting /login (or /) are sent to /courses,
 * - /admin/* is reserved for global admins.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser();
  const nuxtApp = useNuxtApp();
  const redirect = (target: string) =>
    nuxtApp.runWithContext(() => navigateTo(target));

  // Always re-check on /login so an expired session cannot cause a redirect loop.
  user.value = await fetchAuthUser();

  if (to.path === "/login") {
    return user.value ? redirect("/courses") : undefined;
  }

  if (!user.value) {
    return redirect("/login");
  }

  if (to.path === "/") {
    return redirect("/courses");
  }

  if (to.path.startsWith("/admin") && !user.value.isGlobalAdmin) {
    return redirect("/courses");
  }
});
