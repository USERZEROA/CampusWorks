export function useIntervalRefresh(refresh: () => Promise<any>, delay = 5000) {
  const nuxtApp = useNuxtApp();
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;
  onMounted(() => {
    timer = setInterval(async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await nuxtApp.runWithContext(refresh);
      } finally {
        refreshing = false;
      }
    }, delay);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });
}
