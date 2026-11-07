export type BackgroundRefreshOptions = { signal: AbortSignal; dedupe: "defer" };

export function useIntervalRefresh(
  refresh: (options: BackgroundRefreshOptions) => Promise<unknown>,
  delay = 5000,
) {
  const nuxtApp = useNuxtApp();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let queued = false;
  const ready = () => mounted && !document.hidden && navigator.onLine !== false;
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clearTimer();
    if (ready()) timer = setTimeout(() => { void synchronize(); }, Math.max(250, delay));
  };
  const synchronize = (): Promise<void> => {
    if (!ready()) return Promise.resolve();
    clearTimer();
    if (running) {
      queued = true;
      return running;
    }
    controller = new AbortController();
    const signal = controller.signal;
    running = Promise.resolve()
      .then(() => {
        if (!mounted || signal.aborted) return;
        return nuxtApp.runWithContext(() => refresh({ signal, dedupe: "defer" }));
      })
      .then(() => undefined)
      // Data loaders keep their own error state; background failures never escape.
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
        controller = undefined;
        if (!mounted) return;
        if (queued && ready()) {
          queued = false;
          void synchronize();
        } else {
          queued = false;
          schedule();
        }
      });
    return running;
  };
  const resume = () => {
    if (!ready()) return;
    clearTimer();
    if (running) {
      queued = true;
      return;
    }
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      if (ready()) void synchronize();
    }, 100);
  };
  onMounted(() => {
    mounted = true;
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    void synchronize();
  });
  onBeforeUnmount(() => {
    mounted = false;
    queued = false;
    clearTimer();
    if (wakeTimer) clearTimeout(wakeTimer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    controller?.abort();
  });
}
