export function useCourseCatalogLoader<T extends { id: string }>() {
  const requestFetch = useRequestFetch();
  const pages = ref(1);
  const loadingMore = ref(false);
  type Catalog = {
    user: AuthUser;
    courses: T[];
    pagination?: {
      offset: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
  };
  let lastComplete: Catalog | undefined;
  function prime(value: Catalog | null | undefined) {
    if (value) lastComplete = value;
  }
  async function load(_app?: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<Catalog> {
    try {
      let result: Catalog | undefined;
      const records = new Map<string, T>();
      for (let page = 0; page < pages.value; page++) {
        const current = await requestFetch<Catalog>("/api/courses", {
          signal, query: { offset: page * 200, limit: 200 },
        });
        if (!result) result = current;
        result.pagination = current.pagination;
        for (const course of current.courses) records.set(course.id, course);
        if (!current.pagination?.hasMore) break;
      }
      lastComplete = { ...result!, courses: [...records.values()] };
      return lastComplete;
    } catch (error: any) {
      const status = error?.statusCode || error?.response?.status;
      if (lastComplete && ![401, 403, 404].includes(status) && !signal?.aborted) return lastComplete;
      throw error;
    }
  }
  async function more(refresh: () => Promise<any>) {
    if (loadingMore.value) return;
    loadingMore.value = true;
    pages.value++;
    try {
      await refresh();
    } finally {
      loadingMore.value = false;
    }
  }
  return { load, more, loadingMore, prime };
}
