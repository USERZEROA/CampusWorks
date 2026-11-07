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
  const requestFetch = useRequestFetch();
  const staffing = useStaffingCapabilities();
  const redirect = (target: string) =>
    nuxtApp.runWithContext(() => navigateTo(target));

  // Always re-check on /login so an expired session cannot cause a redirect loop.
  user.value = await fetchAuthUser();

  if (to.path === "/login") {
    return user.value ? redirect("/courses") : undefined;
  }

  if (!user.value) {
    staffing.value = null;
    return redirect("/login");
  }

  if (to.path === "/") {
    return redirect("/courses");
  }

  if (to.path.startsWith("/admin") && !user.value.isGlobalAdmin) {
    return redirect("/courses");
  }
  if (to.path === "/projects" || to.path.startsWith("/projects/"))
    return redirect("/courses");

  const management =
    to.path === "/staffing" || to.path.startsWith("/staffing/");
  const recruitment =
    management ||
    to.path.startsWith("/opportunities") ||
    to.path.startsWith("/applications") ||
    to.path === "/admin/staffing" ||
    /^\/courses\/[^/]+\/review$/.test(to.path);
  if (to.path === "/courses" || recruitment) {
    try {
      staffing.value = await requestFetch<StaffingCapabilities>(
        "/api/staffing/capabilities",
      );
    } catch (error: any) {
      staffing.value = null;
      if ((error?.statusCode || error?.response?.status) === 401) {
        user.value = null;
        return redirect("/login");
      }
      if (recruitment) return redirect("/courses");
    }
  }
  if (!recruitment || !staffing.value) return;
  const viewer = staffing.value.viewer;
  if (
    (management || /^\/courses\/[^/]+\/review$/.test(to.path)) &&
    !viewer.canManageStaffing
  )
    return redirect("/courses");
  if (
    /^\/courses\/[^/]+\/review$/.test(to.path) &&
    !staffing.value.currentCycle?.termId
  )
    return redirect("/courses");
  if (to.path === "/opportunities" && !viewer.canBrowseStaffing)
    return redirect("/courses");
  if (
    (to.path.startsWith("/opportunities/") ||
      to.path.startsWith("/applications/")) &&
    !viewer.canBrowseStaffing &&
    !viewer.canManageStaffing
  )
    return redirect("/courses");
});
