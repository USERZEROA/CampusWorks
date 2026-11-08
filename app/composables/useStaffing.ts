import type { Ref, WatchSource } from "vue";

export type StaffingCapabilities = {
  viewer: {
    canManageStaffing: boolean;
    canApplyStaffing: boolean;
    canBrowseStaffing: boolean;
    isGlobalAdmin: boolean;
  };
  currentCycle: any;
};
export const useStaffingCapabilities = () =>
  useState<StaffingCapabilities | null>("staffing-capabilities", () => null);

export const staffingId = (value: any): string =>
  String(value?.id || value?._id || "");
export const staffingDate = (value: any): string =>
  value ? new Date(value).toLocaleString() : "Not specified";
export const staffingState = (value: any): string =>
  String(value || "draft").replaceAll("_", " ");
export const staffingSnapshot = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );
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
export function useStaffingPagedRecord(
  key: string,
  url: string,
  options: {
    query?: () => Record<string, any>;
    watch?: WatchSource[];
  } = {},
) {
  const requestFetch = useRequestFetch();
  const capabilities = useStaffingCapabilities();
  const pageCount = useState<number>(`${key}-page-count`, () => 1);
  const previousScope = useState<string | null>(`${key}-scope`, () => null);
  const responseScope = (value: any) =>
    String(value.termId ?? value.currentCycle?.termId ?? "");
  let lastComplete: any;
  const state = useAsyncData<any>(
    key,
    async (_app, { signal }) => {
      try {
        const query = options.query?.() || {};
        const requestedPages = pageCount.value;
        let result: any;
        const names = [
          "terms",
          "courses",
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
        const merge = (
          left: any[] = [],
          right: any[] = [],
          recordKey: (item: any) => string = staffingId,
        ) => [
          ...new Map(
            [...left, ...right].map((item) => [recordKey(item), item]),
          ).values(),
        ];
        for (let page = 1; page <= requestedPages; page++) {
          const current = await requestFetch<any>(url, {
            query: { ...query, page },
            signal,
          });
          const currentScope = responseScope(current);
          if (
            page === 1 &&
            previousScope.value !== null &&
            previousScope.value !== currentScope
          ) {
            previousScope.value = currentScope;
            pageCount.value = 1;
            return current;
          }
          if (result && responseScope(result) !== currentScope) {
            pageCount.value = 1;
            const restarted = await requestFetch<any>(url, {
              query: { ...query, page: 1 },
              signal,
            });
            previousScope.value = responseScope(restarted);
            return restarted;
          }
          previousScope.value = currentScope;
          if (!result) result = current;
          else {
            const previous = result;
            result = { ...previous, ...current };
            for (const name of names)
              if (Array.isArray(current[name]))
                result[name] = merge(previous[name], current[name]);
            if (current.admin)
              result.admin = {
                ...current.admin,
                pendingOpportunities: merge(
                  previous.admin?.pendingOpportunities,
                  current.admin.pendingOpportunities,
                ),
                appointments: merge(
                  previous.admin?.appointments,
                  current.admin.appointments,
                ),
              };
            if (current.workload)
              result.workload = {
                ...current.workload,
                records: merge(
                  previous.workload?.records,
                  current.workload.records,
                ),
              };
            if (current.staffing)
              result.staffing = {
                ...current.staffing,
                opportunities: merge(
                  previous.staffing?.opportunities,
                  current.staffing.opportunities,
                ),
              };
          }
          const more = current.pagination?.hasMore;
          if (
            !more ||
            (typeof more === "object" && !Object.values(more).some(Boolean))
          )
            break;
        }
        return result;
      } catch (failure: any) {
        const status =
          failure?.statusCode ||
          failure?.response?.status ||
          failure?.data?.statusCode;
        if ([401, 403, 404].includes(status)) {
          lastComplete = undefined;
          throw failure;
        }
        if (lastComplete) return lastComplete;
        throw failure;
      }
    },
    { watch: options.watch, dedupe: "defer" },
  );
  guardStaffingAccess(state.data, state.error);
  watch(
    state.data,
    (value) => {
      if (value) lastComplete = value;
      if (value?.viewer && value.currentCycle)
        capabilities.value = {
          viewer: value.viewer,
          currentCycle: value.currentCycle,
        };
    },
    { immediate: true },
  );
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
      if (status !== 401 && status !== 403 && status !== 404) return;
      data.value = null;
      if (status === 401) {
        currentUser.value = null;
        authError.value = "Your session expired. Please sign in again.";
        if (import.meta.client)
          nuxtApp.runWithContext(() => navigateTo("/login", { replace: true }));
      } else {
        nuxtApp.runWithContext(() => navigateTo("/courses", { replace: true }));
      }
    },
    { immediate: true },
  );
}
export function useStaffingMutation(refresh?: (options?: any) => Promise<any>) {
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
      if (refresh) await refresh({ dedupe: "cancel" });
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
      if ([403, 404].includes(status)) {
        if (refresh) await refresh({ dedupe: "cancel" }).catch(() => {});
        await nuxtApp.runWithContext(() =>
          navigateTo("/courses", { replace: true }),
        );
        return null;
      }
      if (status === 409 && refresh)
        await refresh({ dedupe: "cancel" }).catch(() => {});
      message.value = apiErrorMessage(
        error,
        "The action could not be completed. Your changes are kept.",
      );
      return null;
    } finally {
      busy.value = false;
    }
  }
  return { busy, message, failure, run };
}
