import type { Ref } from "vue";

export const staffingId = (value: any): string =>
  String(value?.id || value?._id || "");
export const staffingDate = (value: any): string =>
  value ? new Date(value).toLocaleString() : "Not specified";
export const staffingState = (value: any): string =>
  String(value || "draft").replaceAll("_", " ");
export function staffingRequest<T = any>(
  url: string,
  options?: Record<string, any>,
): Promise<T> {
  return ($fetch as (url: string, options?: Record<string, any>) => Promise<T>)(
    url,
    options,
  );
}
export function useStaffingOverview(key = "staffing-overview") {
  return useStaffingPagedRecord(key, "/api/staffing/overview");
}
export function useStaffingPagedRecord(key: string, url: string) {
  const requestFetch = useRequestFetch();
  const pageCount = useState<number>(`${key}-page-count`, () => 1);
  const state = useAsyncData<any>(key, async () => {
    let result: any;
    const names = [
      "terms",
      "courses",
      "projects",
      "opportunities",
      "myApplications",
      "myAppointments",
      "managedOpportunities",
      "adminAppointments",
      "applications",
      "appointments",
      "offers",
      "notifications",
    ];
    const merge = (left: any[] = [], right: any[] = []) => [
      ...new Map(
        [...left, ...right].map((item) => [staffingId(item), item]),
      ).values(),
    ];
    for (let page = 1; page <= pageCount.value; page++) {
      const current = await requestFetch<any>(url, { query: { page } });
      if (!result) result = current;
      else {
        for (const name of names)
          if (Array.isArray(current[name]))
            result[name] = merge(result[name], current[name]);
        if (current.admin)
          result.admin = {
            ...current.admin,
            pendingOpportunities: merge(
              result.admin?.pendingOpportunities,
              current.admin.pendingOpportunities,
            ),
            appointments: merge(
              result.admin?.appointments,
              current.admin.appointments,
            ),
          };
        result.pagination = current.pagination;
      }
      const more = current.pagination?.hasMore;
      if (
        !more ||
        (typeof more === "object" && !Object.values(more).some(Boolean))
      )
        break;
    }
    return result;
  });
  guardStaffingAccess(state.data, state.error);
  return state;
}
export function guardStaffingAccess(data: Ref<any>, error: Ref<any>) {
  const nuxtApp = useNuxtApp();
  const currentUser = useAuthUser();
  const authError = useAuthError();
  watch(
    error,
    (value: any) => {
      const status =
        value?.statusCode || value?.response?.status || value?.data?.statusCode;
      if (status !== 401 && status !== 403) return;
      data.value = null;
      if (status === 401) {
        currentUser.value = null;
        authError.value = "Your session expired. Please sign in again.";
        if (import.meta.client)
          nuxtApp.runWithContext(() => navigateTo("/login", { replace: true }));
      }
    },
    { immediate: true },
  );
}
export function useStaffingMutation(refresh?: () => Promise<any>) {
  const nuxtApp = useNuxtApp();
  const currentUser = useAuthUser();
  const authError = useAuthError();
  const busy = ref(false);
  const message = ref("");
  const failure = ref(false);
  async function run(action: () => Promise<any>, success = "Saved.") {
    if (busy.value) return null;
    busy.value = true;
    failure.value = false;
    message.value = "";
    try {
      const result = await action();
      if (refresh) await refresh();
      message.value = success;
      return result;
    } catch (error: any) {
      failure.value = true;
      const status =
        error?.statusCode || error?.response?.status || error?.data?.statusCode;
      if (status === 401) {
        currentUser.value = null;
        authError.value = "Your session expired. Please sign in again.";
        await nuxtApp.runWithContext(() =>
          navigateTo("/login", { replace: true }),
        );
        return null;
      }
      message.value = apiErrorMessage(
        error,
        "The action could not be completed. Please refresh and try again.",
      );
      return null;
    } finally {
      busy.value = false;
    }
  }
  return { busy, message, failure, run };
}
