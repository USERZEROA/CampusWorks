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
  return useAsyncData<any>(key, async () => {
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
}
export function useStaffingMutation(refresh?: () => Promise<any>) {
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
