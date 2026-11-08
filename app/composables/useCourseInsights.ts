import type { MaybeRefOrGetter } from "vue";
import type { AuthUser } from "./useAuth";
import type {
  CourseInsights,
  InsightsCourse,
} from "../../shared/course-insights";

export const insightsIdentityScope = (user: AuthUser | null | undefined) =>
  user
    ? JSON.stringify([
        user.id || null,
        user.email,
        user.provider,
        user.primaryRole,
        user.isGlobalAdmin,
      ])
    : "";

export async function useCourseInsights(
  courseId?: MaybeRefOrGetter<string | undefined>,
  range?: {
    from?: MaybeRefOrGetter<string | undefined>;
    to?: MaybeRefOrGetter<string | undefined>;
  },
) {
  const user = useAuthUser();
  const app = useNuxtApp();
  const request = useRequestFetch();
  const selection = ref(toValue(courseId) || "");
  const from = ref(toValue(range?.from) || "");
  const to = ref(toValue(range?.to) || "");
  const notice = ref("");
  const denied = ref(false);
  const courseOptions = ref<Pick<InsightsCourse, "id" | "code" | "title">[]>(
    [],
  );
  const scope = computed(() => `${selection.value}:${from.value}:${to.value}`);
  const owner = () => insightsIdentityScope(user.value);
  const initialOwner = owner();
  const expectedTermId = ref("");
  let previous: CourseInsights | null = null;
  let previousScope = "";
  let generation = 0;
  let settingRange = false;
  let clearVisible: (() => void) | undefined;
  let execute:
    | ((options?: {
        dedupe?: "cancel" | "defer";
        signal?: AbortSignal;
      }) => Promise<void>)
    | undefined;
  // Register effects before the first await so Vue disposes every subscription
  // with the component, including on a mid-request navigation.
  watch(
    [selection, from, to],
    () => {
      if (settingRange) return;
      clearVisible?.();
      notice.value = "";
      if (execute && owner() === initialOwner)
        void execute({ dedupe: "cancel" });
    },
    { flush: "sync" },
  );
  watch(
    owner,
    (value) => {
      if (value === initialOwner) return;
      generation++;
      denied.value = true;
      previous = null;
      previousScope = "";
      expectedTermId.value = "";
      courseOptions.value = [];
      clearVisible?.();
    },
    { flush: "sync" },
  );
  if (courseId)
    watch(
      () => toValue(courseId),
      (value) => {
        selection.value = value || "";
      },
    );
  if (range?.from)
    watch(
      () => toValue(range.from),
      (value) => {
        if (value !== undefined && value !== from.value) from.value = value;
      },
    );
  if (range?.to)
    watch(
      () => toValue(range.to),
      (value) => {
        if (value !== undefined && value !== to.value) to.value = value;
      },
    );
  onBeforeUnmount(() => {
    generation++;
  });
  useIntervalRefresh(
    (options) => (execute ? execute(options) : Promise.resolve()),
    10000,
  );
  const { data, error, status, refresh } =
    await useAsyncData<CourseInsights | null>(
      `course-insights:${initialOwner}:${toValue(courseId) || "portfolio"}`,
      async (_app, { signal }) => {
        if (owner() !== initialOwner) return null;
        const requested = scope.value;
        const requestedCourse = selection.value;
        const turn = ++generation;
        try {
          const result = await request<CourseInsights>("/api/insights", {
            signal,
            query: {
              courseId: requestedCourse || undefined,
              from: from.value || undefined,
              to: to.value || undefined,
              expectedTermId: expectedTermId.value || undefined,
            },
          });
          if (
            signal.aborted ||
            turn !== generation ||
            requested !== scope.value ||
            owner() !== initialOwner
          )
            return null;
          notice.value = "";
          denied.value = false;
          expectedTermId.value = result.currentCycle.termId;
          if (!from.value || !to.value) {
            settingRange = true;
            from.value ||= result.range.from;
            to.value ||= result.range.to;
            settingRange = false;
          }
          previous = result;
          previousScope = scope.value;
          if (!requestedCourse || !courseOptions.value.length)
            courseOptions.value = result.courses.map(({ id, code, title }) => ({
              id,
              code,
              title,
            }));
          return result;
        } catch (failure: any) {
          if (
            signal.aborted ||
            turn !== generation ||
            requested !== scope.value ||
            owner() !== initialOwner
          )
            throw failure;
          const code = failure?.statusCode || failure?.response?.status;
          const reason = failure?.data?.data?.code || failure?.data?.code;
          if (code === 409 && reason === "INSIGHTS_TERM_CHANGED") {
            generation++;
            previous = null;
            previousScope = "";
            expectedTermId.value = "";
            courseOptions.value = [];
            clearVisible?.();
            notice.value =
              "The current semester changed. Loading its course data…";
            settingRange = true;
            selection.value = toValue(courseId) || "";
            from.value = "";
            to.value = "";
            settingRange = false;
            queueMicrotask(() => {
              if (execute && owner() === initialOwner)
                void app.runWithContext(() => execute!({ dedupe: "cancel" }));
            });
            return null;
          }
          if ([401, 403, 404].includes(code)) {
            denied.value = true;
            previous = null;
            previousScope = "";
            courseOptions.value = [];
            clearVisible?.();
            if (code === 401) {
              user.value = null;
              await app.runWithContext(() =>
                navigateTo("/login", { replace: true }),
              );
            }
            return null;
          }
          notice.value = apiErrorMessage(
            failure,
            "Connection interrupted. Showing the last complete snapshot.",
          );
          if (previous && previousScope === requested) return previous;
          throw failure;
        }
      },
      { default: () => null, dedupe: "cancel" },
    );
  clearVisible = () => {
    data.value = null;
  };
  if (owner() !== initialOwner || denied.value) {
    data.value = null;
    previous = null;
  } else previous = data.value || previous;
  if (data.value) {
    settingRange = true;
    from.value ||= data.value.range.from;
    to.value ||= data.value.range.to;
    previousScope = scope.value;
    expectedTermId.value = data.value.currentCycle.termId;
    courseOptions.value = data.value.courses.map(({ id, code, title }) => ({
      id,
      code,
      title,
    }));
    settingRange = false;
  }
  execute = refresh;
  return {
    data,
    error,
    status,
    notice,
    denied,
    selection,
    from,
    to,
    courseOptions,
  };
}
