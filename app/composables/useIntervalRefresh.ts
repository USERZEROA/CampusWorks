export function useIntervalRefresh(refresh: () => Promise<any>, delay = 5000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;
  onMounted(() => {
    timer = setInterval(async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await refresh();
      } finally {
        refreshing = false;
      }
    }, delay);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });
}
