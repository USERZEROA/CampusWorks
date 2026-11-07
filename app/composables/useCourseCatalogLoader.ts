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
  async function load(): Promise<Catalog> {
    let result: Catalog | undefined;
    const records = new Map<string, T>();
    for (let page = 0; page < pages.value; page++) {
      const current = await requestFetch<Catalog>("/api/courses", {
        query: { offset: page * 200, limit: 200 },
      });
      if (!result) result = current;
      result.pagination = current.pagination;
      for (const course of current.courses) records.set(course.id, course);
      if (!current.pagination?.hasMore) break;
    }
    return { ...result!, courses: [...records.values()] };
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
  return { load, more, loadingMore };
}
