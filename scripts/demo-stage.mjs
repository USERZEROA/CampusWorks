import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { chromium } from "@playwright/test";

const foregroundScript = fileURLToPath(
  new URL("./demo-foreground.ps1", import.meta.url),
);
const roleLabels = {
  student: "Student",
  ta: "TA",
  instructor: "Instructor",
  admin: "Administrator",
};
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function createForegroundBridge() {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      foregroundScript,
      "-Persistent",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let queued = Promise.resolve();
  let pending;
  let failed;
  let closing;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const fail = () => {
    failed = new Error("The owned demonstration foreground helper stopped.");
    pending?.reject(failed);
    pending = undefined;
  };
  child.once("error", fail);
  child.once("exit", fail);
  child.stdin.on("error", fail);
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!pending) return;
    try {
      pending.resolve(JSON.parse(line));
    } catch {
      pending.reject(
        new Error(
          "The owned demonstration foreground helper returned an invalid response.",
        ),
      );
    }
    pending = undefined;
  });
  return {
    pid: child.pid,
    activate(titleToken) {
      if (closing)
        return Promise.reject(
          new Error("The demonstration foreground helper is closing."),
        );
      const request = queued.then(
        () =>
          new Promise((resolve, reject) => {
            if (failed) {
              reject(failed);
              return;
            }
            const timeout = setTimeout(() => {
              failed = new Error(
                "The owned demonstration foreground helper timed out.",
              );
              pending = undefined;
              child.kill();
              reject(failed);
            }, 10000);
            pending = {
              resolve: (result) => {
                clearTimeout(timeout);
                resolve(result);
              },
              reject: (error) => {
                clearTimeout(timeout);
                reject(error);
              },
            };
            child.stdin.write(`${titleToken}\n`);
          }),
      );
      queued = request.catch(() => {});
      return request;
    },
    close() {
      if (closing) return closing;
      closing = (async () => {
        try {
          await queued;
          if (child.exitCode === null && child.signalCode === null) {
            child.stdin.end("__CLOSE__\n");
            await Promise.race([exited, wait(2000)]);
            if (child.exitCode === null && child.signalCode === null)
              child.kill();
            await Promise.race([exited, wait(2000)]);
          }
          if (
            child.pid &&
            child.exitCode === null &&
            child.signalCode === null
          ) {
            let present = true;
            try {
              process.kill(child.pid, 0);
            } catch (error) {
              if (error.code === "ESRCH") present = false;
            }
            if (present)
              throw new Error(
                "The owned demonstration foreground helper could not be stopped.",
              );
          }
        } finally {
          lines.close();
        }
      })();
      return closing;
    },
  };
}

export class DemoStopped extends Error {
  constructor(message = "The demonstration was stopped.") {
    super(message);
    this.name = "DemoStopped";
  }
}

export function createDemoClock(now = () => performance.now()) {
  const startedAt = now();
  let pausedAt = null;
  let completedPauses = 0;
  return {
    setPaused(value) {
      if (value && pausedAt === null) pausedAt = now();
      else if (!value && pausedAt !== null) {
        completedPauses += now() - pausedAt;
        pausedAt = null;
      }
    },
    get elapsedMs() {
      return Math.max(0, (pausedAt ?? now()) - startedAt - completedPauses);
    },
    get pausedMs() {
      return completedPauses + (pausedAt === null ? 0 : now() - pausedAt);
    },
  };
}

// This function executes only inside the automation-owned browser contexts.
function installDemoOverlay({ titleToken }) {
  let lastState;
  let observer;
  let resize;
  let originalPadding;
  const elementId = "campusworks-demo-stage";
  const styleId = "campusworks-demo-stage-style";
  const command = (value) => {
    void window.__campusworksDemoCommand(value).catch(() => {});
  };
  const keyboard = (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]');
    if (event.key === "Pause") {
      event.preventDefault();
      command("toggle-pause");
    } else if (!editing && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      command(event.key === "ArrowLeft" ? "previous" : "next");
    } else if (!editing && (event.code === "Space" || event.key === " ") && !target?.closest(`#${elementId} button`)) {
      event.preventDefault();
      command("toggle-pause");
    }
  };
  document.addEventListener("keydown", keyboard, true);
  const fixTitle = () => {
    const prefix = `[${titleToken}] `;
    if (!document.title.startsWith(prefix))
      document.title = prefix + document.title;
  };
  function render(state) {
    lastState = state;
    if (!document.body || !document.head) return;
    let banner = document.getElementById(elementId);
    if (!banner) {
      originalPadding = getComputedStyle(document.body).paddingTop;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        body[data-campusworks-demo-stage] { padding-top: calc(var(--campusworks-demo-original-padding, 0px) + var(--campusworks-demo-offset, 92px)) !important; }
        #${elementId} { position:fixed; inset:0 0 auto; z-index:2147483000; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px 20px; box-sizing:border-box; padding:12px 22px 10px; background:#012169; color:#fff; border-bottom:3px solid #00c7a3; box-shadow:0 4px 18px #01216930; font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
        #${elementId} * { box-sizing:border-box; }
        #${elementId} .demo-identity { display:flex; align-items:center; flex-wrap:wrap; gap:7px 12px; color:#fff; font-size:13px; }
        #${elementId} .demo-badge { padding:2px 7px; border:1px solid #a5c7ff; border-radius:4px; font-size:10px; letter-spacing:0.08em; }
        #${elementId} .demo-role { font-weight:750; font-size:17px; }
        #${elementId} .demo-cycle { color:#dbe7ff; font-size:11px; }
        #${elementId} .demo-step-title { margin:5px 0 0; color:#fff; font-size:16px; font-weight:700; }
        #${elementId} .demo-detail { margin:3px 0 0; color:#e4edff; font-size:12px; }
        #${elementId} .demo-controls { align-self:center; display:flex; gap:8px; }
        #${elementId} button { min-height:36px; padding:6px 13px; border:1px solid #9dbaf2; border-radius:6px; background:#fff; color:#012169; font:600 12px/1.4 system-ui,sans-serif; cursor:pointer; }
        #${elementId} button:focus-visible { outline:3px solid #ffcf4a; outline-offset:3px; }
        #${elementId} button[data-demo-stop] { color:#fff; background:transparent; }
        #${elementId} progress { grid-column:1 / -1; width:100%; height:4px; appearance:none; border:0; background:#5475ac; border-radius:2px; }
        #${elementId} progress::-webkit-progress-bar { background:#5475ac; border-radius:2px; }
        #${elementId} progress::-webkit-progress-value { background:#00e1b5; border-radius:2px; }
        #${elementId} progress::-moz-progress-bar { background:#00e1b5; }
        [data-campusworks-demo-spotlight] { outline:2px solid #b45309 !important; outline-offset:2px !important; scroll-margin-top:calc(var(--campusworks-demo-offset, 92px) + 24px) !important; }
        @media(max-width:600px) { #${elementId} { padding:10px 12px 8px; gap:6px 10px; } #${elementId} .demo-role { font-size:14px; } #${elementId} .demo-step-title { font-size:14px; } #${elementId} .demo-controls { flex-direction:column; gap:5px; } #${elementId} button { min-height:32px; padding:4px 9px; } }
      `;
      document.head.append(style);
      banner = document.createElement("section");
      banner.id = elementId;
      banner.setAttribute("aria-label", state.manual ? "Keyboard demonstration controls" : "Automatic demonstration controls");
      banner.setAttribute("data-testid", "demo-stage");
      const copy = document.createElement("div");
      copy.innerHTML =
        '<div class="demo-identity"><span class="demo-badge">DEMO</span><span class="demo-role"></span><span class="demo-person"></span><span class="demo-cycle"></span></div><p class="demo-step-title" role="status" aria-live="polite" aria-atomic="true"></p><p class="demo-detail"></p>';
      const controls = document.createElement("div");
      controls.className = "demo-controls";
      const pauseButton = document.createElement("button");
      pauseButton.type = "button";
      pauseButton.dataset.demoPause = "";
      pauseButton.setAttribute("aria-keyshortcuts", "Space Pause");
      pauseButton.addEventListener("click", () => {
        command("toggle-pause");
      });
      const previousButton = document.createElement("button");
      previousButton.type = "button";
      previousButton.dataset.demoPrev = "";
      previousButton.textContent = "←";
      previousButton.setAttribute("aria-label", "Previous visited page");
      previousButton.setAttribute("aria-keyshortcuts", "ArrowLeft");
      previousButton.addEventListener("click", () => command("previous"));
      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.dataset.demoNext = "";
      nextButton.textContent = "→";
      nextButton.setAttribute("aria-label", "Next visited page");
      nextButton.setAttribute("aria-keyshortcuts", "ArrowRight");
      nextButton.addEventListener("click", () => command("next"));
      const stopButton = document.createElement("button");
      stopButton.type = "button";
      stopButton.dataset.demoStop = "";
      stopButton.textContent = "Stop demo";
      stopButton.addEventListener("click", () => {
        command("stop");
      });
      controls.append(previousButton, pauseButton, nextButton, stopButton);
      const progress = document.createElement("progress");
      progress.setAttribute("aria-label", "Cycle progress");
      banner.append(copy, controls, progress);
      document.body.prepend(banner);
      document.body.setAttribute("data-campusworks-demo-stage", "");
      document.documentElement.style.setProperty(
        "--campusworks-demo-original-padding",
        originalPadding,
      );
      resize = new ResizeObserver(() =>
        document.documentElement.style.setProperty(
          "--campusworks-demo-offset",
          `${banner.getBoundingClientRect().height}px`,
        ),
      );
      resize.observe(banner);
    }
    banner.querySelector(".demo-role").textContent = state.role;
    banner.querySelector(".demo-person").textContent = state.person;
    banner.querySelector(".demo-cycle").textContent =
      `Cycle ${state.cycle} · ${state.index} / ${state.totalSteps}`;
    banner.querySelector(".demo-step-title").textContent = state.stopped
      ? "Demonstration stopped"
      : `${state.reviewing ? "Review · " : state.paused ? "Paused · " : state.manual && state.waitingForAdvance ? "Ready · " : ""}${state.title}`;
    banner.querySelector(".demo-detail").textContent = state.reviewing
      ? `Visited page · current data. ${state.detail || ""}`
      : state.manual
        ? `${state.waitingForAdvance ? `Next: ${state.nextTitle}. ` : ""}← Review · → Next step · Space Pause/Resume. ${state.detail || ""}`
        : state.detail || "";
    banner.querySelector("[data-demo-pause]").textContent = state.paused
      ? "Resume"
      : "Pause";
    banner
      .querySelector("[data-demo-pause]")
      .setAttribute("aria-pressed", String(state.paused));
    banner.querySelector("[data-demo-pause]").title = state.paused
      ? "Resume playback (Space or Pause/Break)"
      : "Pause playback (Space or Pause/Break)";
    banner.querySelector("[data-demo-prev]").disabled = !state.canPrevious;
    banner.querySelector("[data-demo-next]").disabled = !state.canNext;
    banner.querySelector("[data-demo-next]").setAttribute("aria-label", state.manual && !state.reviewing ? "Next step" : "Next visited page");
    const main = document.querySelector("main");
    if (main) main.inert = !!state.reviewing;
    banner.querySelector("progress").max = Math.max(1, state.totalSteps);
    banner.querySelector("progress").value = Math.min(
      state.index,
      state.totalSteps,
    );
    fixTitle();
  }
  window.__campusworksDemoRender = render;
  const boot = async () => {
    render(await window.__campusworksDemoCommand("state"));
    observer = new MutationObserver(() => {
      fixTitle();
      if (!document.getElementById(elementId) && lastState) render(lastState);
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  if (document.readyState === "loading")
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void boot();
      },
      { once: true },
    );
  else void boot();
  window.__campusworksDemoRemove = () => {
    document.removeEventListener("keydown", keyboard, true);
    observer?.disconnect();
    resize?.disconnect();
    document.getElementById(elementId)?.remove();
    document.getElementById(styleId)?.remove();
    document.body?.removeAttribute("data-campusworks-demo-stage");
    const main = document.querySelector("main");
    if (main) main.inert = false;
    document.documentElement.style.removeProperty(
      "--campusworks-demo-original-padding",
    );
    document.documentElement.style.removeProperty("--campusworks-demo-offset");
    document.title = document.title.replace(`[${titleToken}] `, "");
  };
}

export async function createDemoStage({
  windows,
  baseURL,
  headless = false,
  holdMs = 1200,
  beforeMs = holdMs,
  totalSteps = 1,
  cycle = 1,
  onStop,
  onStep,
  strictForeground = true,
  recordVideoDirectory,
  manual = false,
} = {}) {
  const origin = new URL(baseURL);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password
  )
    throw new Error("The demonstration stage requires a local application.");
  if (!Array.isArray(windows) || !windows.length || windows.length > 6)
    throw new Error("Provide one to six independent demo identities.");
  if (
    ![holdMs, beforeMs].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 60000,
    )
  )
    throw new Error("Use demo pauses between zero and sixty seconds.");
  const token = randomBytes(6).toString("hex");
  const actors = new Map();
  const foregroundChecks = [];
  let foregroundCheckCount = 0;
  let foregroundBridge;
  let paused = false;
  let waitingForAdvance = false;
  let advanceRequested = false;
  let advanceGeneration = 0;
  let nextTitle = "";
  let stopped = false;
  let stopReason = null;
  let closing;
  const clock = createDemoClock();
  const history = [];
  const presenterNavigation = [];
  let review = null;
  let controls = Promise.resolve();
  let current = {
    actor: null,
    title: "Preparing the full product lifecycle",
    detail:
      "Each window has an independent identity. Actions use local synthetic demo records.",
    index: 0,
    totalSteps,
    cycle,
  };
  const stateFor = (actor, page = actor.page) => ({
    ...(review?.page === page ? review.entry : current),
    paused,
    manual,
    waitingForAdvance,
    nextTitle,
    stopped,
    reviewing: review?.page === page,
    canPrevious: review ? review.position > 0 : history.length > (history.at(-1)?.index === current.index ? 1 : 0),
    canNext: manual
      ? (review ? true : waitingForAdvance && !paused && !advanceRequested)
      : !!review && review.position < history.length - 1,
    active: (review?.page === page ? review.entry.actor : current.actor) === actor.key,
    role: review?.page === page ? review.entry.role : actor.displayRole || roleLabels[actor.win.as],
    person: actor.win.name || actor.win.label || actor.key,
  });
  const publish = () =>
    Promise.allSettled(
      [...actors.values()].map((actor) =>
        actor.page?.evaluate(
          (state) => window.__campusworksDemoRender?.(state),
          stateFor(actor),
        ),
      ).concat(review ? [review.page.evaluate(
        (state) => window.__campusworksDemoRender?.(state),
        stateFor(getActor(review.entry.actor), review.page),
      )] : []),
    );
  function checkStopped() {
    if (stopped) throw new DemoStopped();
  }
  const setPaused = async (value) => {
    if (!stopped) {
      paused = value;
      clock.setPaused(value);
    }
    await publish();
  };
  const stop = async (reason = "requested") => {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
    paused = false;
    clock.setPaused(true);
    if (onStop) {
      try {
        void Promise.resolve(onStop(reason)).catch(() => {});
      } catch {}
    }
    await publish();
  };
  async function pausePoint(milliseconds = 0) {
    const deadline = clock.elapsedMs + milliseconds;
    for (;;) {
      checkStopped();
      const remaining = deadline - clock.elapsedMs;
      if (!paused && remaining <= 0) break;
      await wait(Math.min(100, Math.max(1, remaining || 100)));
    }
  }
  async function awaitAdvance(title) {
    advanceGeneration++;
    nextTitle = title;
    advanceRequested = false;
    waitingForAdvance = true;
    await publish();
    while (!advanceRequested || paused) {
      checkStopped();
      await wait(40);
    }
    waitingForAdvance = false;
    advanceRequested = false;
    nextTitle = "";
    await publish();
  }
  const getActor = (key) => {
    const actor = actors.get(key);
    if (!actor) throw new Error("Unknown demonstration identity.");
    return actor;
  };
  const actorFor = (target) => {
    if (typeof target === "string") return getActor(target);
    const actor = [...actors.values()].find(
      (candidate) =>
        candidate.page === target ||
        candidate === target ||
        candidate.key === target?.key,
    );
    if (!actor)
      throw new Error(
        "The foreground target must belong to this demonstration stage.",
      );
    return actor;
  };
  async function leaveReview({ restore = true } = {}) {
    const previous = review;
    review = null;
    if (previous && !previous.page.isClosed()) await previous.page.close();
    if (restore && current.actor && !stopped)
      await foreground(getActor(current.actor), undefined, true);
  }
  async function navigateHistory(direction) {
    await setPaused(true);
    if (!history.length || stopped) return;
    const latestIsCurrent = history.at(-1)?.index === current.index && history.at(-1)?.cycle === current.cycle;
    if (!review && direction > 0) return;
    const cursor = review ? review.position : history.length - (latestIsCurrent ? 1 : 0);
    const position = Math.max(0, Math.min(history.length - 1, cursor + direction));
    if (review?.position === position) return;
    const entry = history[position];
    const actor = getActor(entry.actor);
    await leaveReview({ restore: false });
    checkStopped();
    const page = await actor.context.newPage();
    review = { page, entry, position };
    page.on("close", () => {
      if (review?.page !== page) return;
      review = null;
      void publish();
    });
    await page.route("**/api/**", (route) =>
      ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
    try {
      const response = await page.goto(entry.url);
      if (!response?.ok()) throw new Error("The visited page is no longer available.");
      await page.locator("#campusworks-demo-stage").waitFor({ state: "visible" });
      if (review?.page !== page || stopped) return;
      await publish();
      await foreground(actor, page, true);
      presenterNavigation.push({ direction, actor: entry.actor, index: entry.index, cycle: entry.cycle, url: entry.url, paused: true, actionReplayed: false, checkedAt: new Date().toISOString() });
      if (presenterNavigation.length > 200) presenterNavigation.shift();
    } catch (error) {
      await leaveReview();
      await publish();
      throw error;
    }
  }
  function control(command) {
    // A queued key is valid only for the step waiting when it was pressed.
    const requestedAdvance = manual && command === "next" && !review && waitingForAdvance && !paused && !advanceRequested
      ? advanceGeneration
      : null;
    const work = controls.then(async () => {
      checkStopped();
      if (manual && command === "next") {
        if (review) {
          if (review.position < history.length - 1) await navigateHistory(1);
          else {
            await leaveReview();
            await setPaused(false);
          }
        } else if (requestedAdvance === advanceGeneration && waitingForAdvance && !paused && !advanceRequested) {
          advanceRequested = true;
          waitingForAdvance = false;
          await publish();
        }
      } else if (command === "previous" || command === "next") {
        await navigateHistory(command === "previous" ? -1 : 1);
      } else {
        const value = command === "pause" ? true : command === "resume" ? false : !paused;
        if (!value && review) await leaveReview();
        await setPaused(value);
      }
    });
    controls = work.catch(() => {});
    return work;
  }
  async function login(actor) {
    const response = await actor.context.request.post("/api/auth/mock", {
      data: {
        as: actor.win.as,
        email: actor.win.email,
        ...(actor.win.name ? { name: actor.win.name } : {}),
      },
    });
    if (!response.ok())
      throw new Error(`Demonstration sign-in failed (${response.status()}).`);
  }
  async function foreground(actor, page = actor.page, whilePaused = false) {
    if (!whilePaused) await pausePoint();
    checkStopped();
    await page.bringToFront();
    if (!whilePaused) await pausePoint();
    actor.lastForeground = {
      method: "Playwright",
      headless,
      confirmed: headless,
    };
    if (!headless) {
      const cdp = page === actor.page
        ? actor.cdp ||= await actor.context.newCDPSession(page)
        : await actor.context.newCDPSession(page);
      const { windowId, bounds } = await cdp.send(
        "Browser.getWindowForTarget",
      );
      if (bounds.windowState !== "maximized") {
        if (bounds.windowState !== "normal")
          await cdp.send("Browser.setWindowBounds", {
            windowId,
            bounds: { windowState: "normal" },
          });
        await cdp.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "maximized" },
        });
      }
      actor.lastForeground = {
        method: "Chromium window bounds",
        maximized: true,
        confirmed: false,
      };
      if (process.platform === "win32") {
        foregroundBridge ||= createForegroundBridge();
        let confirmed = false;
        let maximized = false;
        for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
          const result = await foregroundBridge.activate(actor.titleToken);
          confirmed = result.foreground === true && result.maximized === true;
          maximized = result.maximized === true;
          if (!confirmed) await wait(100);
        }
        if (!confirmed && strictForeground)
          throw new Error(
            "The acting demonstration window could not be brought to the foreground.",
          );
        actor.lastForeground = {
          method: "Windows foreground window handle",
          maximized,
          confirmed,
        };
      }
    }
    foregroundChecks.push({
      actor: actor.key,
      review: page !== actor.page,
      checkedAt: new Date().toISOString(),
      ...actor.lastForeground,
    });
    foregroundCheckCount++;
    if (foregroundChecks.length > 2000) foregroundChecks.shift();
    return actor.lastForeground;
  }
  const stage = {
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    get paused() {
      return paused;
    },
    get activeElapsedMs() {
      return clock.elapsedMs;
    },
    get pausedElapsedMs() {
      return clock.pausedMs;
    },
    get history() {
      return history.map((entry) => ({ ...entry }));
    },
    get reviewing() {
      return !!review;
    },
    get presenterNavigation() {
      return presenterNavigation.map((entry) => ({ ...entry }));
    },
    get foregroundChecks() {
      return foregroundChecks.map((check) => ({ ...check }));
    },
    get foregroundCheckCount() {
      return foregroundCheckCount;
    },
    get foregroundHelperPid() {
      return foregroundBridge?.pid;
    },
    get windows() {
      return [...actors.values()].map((actor) => ({
        key: actor.key,
        page: actor.page,
        context: actor.context,
        browser: actor.browser,
        titleToken: actor.titleToken,
      }));
    },
    async recordings() {
      const values = [];
      for (const actor of actors.values()) {
        if (actor.video) values.push({
          actor: actor.key,
          startedAt: actor.videoStartedAt,
          path: await actor.video.path(),
        });
      }
      return values;
    },
    page: (key) => getActor(key).page,
    context: (key) => getActor(key).context,
    async ensureForeground(target) {
      await pausePoint();
      return foreground(actorFor(target));
    },
    pause: () => control("pause"),
    resume: () => control("resume"),
    next: () => control("next"),
    previous: () => control("previous"),
    get waitingForAdvance() { return waitingForAdvance; },
    stop,
    checkpoint: () => pausePoint(),
    hold: (milliseconds) => pausePoint(milliseconds),
    async setCycle(nextCycle) {
      await pausePoint();
      history.length = 0;
      current = { ...current, cycle: nextCycle, index: 0 };
      await publish();
    },
    async setRole(key, role) {
      getActor(key).displayRole = roleLabels[role] || role;
      await publish();
    },
    async loginAll() {
      for (const actor of actors.values()) {
        checkStopped();
        await login(actor);
      }
    },
    async resetSessions({ navigate = true } = {}) {
      for (const actor of actors.values()) {
        checkStopped();
        await actor.context.clearCookies();
        await login(actor);
        actor.displayRole = roleLabels[actor.win.as];
        if (navigate) {
          const response = await actor.page.goto(actor.win.path);
          if (!response?.ok())
            throw new Error("A demonstration starting page did not reload.");
          await actor.page
            .locator("#campusworks-demo-stage")
            .waitFor({ state: "visible" });
          await actor.page.waitForFunction(
            () => !!document.querySelector("#__nuxt")?.__vue_app__,
          );
        }
      }
      await publish();
    },
    async spotlight(locator) {
      await pausePoint();
      await foreground(actorFor(locator.page()));
      await pausePoint();
      await locator.evaluate((element) => {
        document
          .querySelectorAll("[data-campusworks-demo-spotlight]")
          .forEach((previous) =>
            previous.removeAttribute("data-campusworks-demo-spotlight"),
          );
        element.setAttribute("data-campusworks-demo-spotlight", "");
        element.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
      });
      await pausePoint();
    },
    async step(
      {
        actor: key,
        title,
        detail = "",
        role,
        index = current.index + 1,
        cycle: nextCycle = current.cycle,
        durationMs,
        minViewMs = 0,
        holdMs: stepHoldMs = holdMs,
      },
      action,
    ) {
      if (![minViewMs, stepHoldMs, ...(durationMs === undefined ? [] : [durationMs])].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 60000,
      )) throw new Error("Use step durations between zero and sixty seconds.");
      if (manual) await awaitAdvance(title);
      await pausePoint();
      const startedActive = clock.elapsedMs;
      const startedAt = new Date().toISOString();
      const actor = getActor(key);
      if (role) actor.displayRole = roleLabels[role] || role;
      current = {
        ...current,
        actor: key,
        title,
        detail,
        index,
        cycle: nextCycle,
      };
      await publish();
      await pausePoint();
      await foreground(actor);
      await pausePoint(beforeMs);
      const result = await action?.(actor.page, stage);
      const actionDurationMs = clock.elapsedMs - startedActive;
      if (index > 0) {
        const url = actor.page.url();
        if (new URL(url).origin === origin.origin) {
          history.push({ ...current, actor: key, role: stateFor(actor).role, url });
          if (history.length > 200) history.shift();
        }
      }
      await publish();
      const viewHoldMs = manual ? 0 : durationMs === undefined
        ? stepHoldMs
        : Math.max(minViewMs, durationMs - (clock.elapsedMs - startedActive));
      await pausePoint(viewHoldMs);
      if (onStep)
        await onStep({
          ...current,
          role: stateFor(actor).role,
          actor: key,
          url: actor.page.url(),
          foreground: actor.lastForeground,
          actionDurationMs,
          viewHoldMs,
          activeDurationMs: clock.elapsedMs - startedActive,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      return result;
    },
    async close() {
      if (closing) return closing;
      stopped = true;
      closing = (async () => {
        const cleanup = await Promise.allSettled([
          Promise.resolve().then(() => foregroundBridge?.close()),
          ...[...actors.values()].map(async (actor) => {
            await actor.page
              ?.evaluate(() => window.__campusworksDemoRemove?.())
              .catch(() => {});
            await actor.browser.close();
            if (actor.browser.isConnected())
              throw new Error(
                "An owned demonstration browser could not be closed.",
              );
          }),
        ]);
        const failures = cleanup.filter(
          (result) => result.status === "rejected",
        );
        if (failures.length)
          throw new AggregateError(
            failures.map((result) => result.reason),
            "Demonstration browser cleanup is incomplete.",
          );
      })();
      return closing;
    },
  };
  try {
    for (const [index, win] of windows.entries()) {
      const key = win.key || win.actor || String(index);
      if (
        !/^[a-z0-9_-]{1,60}$/i.test(key) ||
        actors.has(key) ||
        !Object.hasOwn(roleLabels, win.as) ||
        !/^[^\s@]+@example\.com$/i.test(win.email || "") ||
        typeof win.path !== "string" ||
        !win.path.startsWith("/") ||
        win.path.startsWith("//") ||
        new URL(win.path, origin).origin !== origin.origin
      )
        throw new Error(
          "Use distinct synthetic local demonstration identities.",
        );
      const browser = await chromium.launch({
        headless,
        args: headless ? [] : ["--start-maximized"],
      });
      const actor = {
        key,
        win,
        browser,
        titleToken: `CW-DEMO-${token}:${key}`,
        context: null,
        page: null,
        displayRole: roleLabels[win.as],
      };
      actors.set(key, actor);
      actor.context = await browser.newContext({
        baseURL: origin.origin,
        viewport: headless ? { width: 1440, height: 1000 } : null,
        ...(recordVideoDirectory ? { recordVideo: { dir: recordVideoDirectory, size: { width: 1440, height: 1000 } } } : {}),
      });
      await actor.context.exposeBinding(
        "__campusworksDemoCommand",
        async (source, command) => {
          if (command === "state") return stateFor(actor, source.page);
          if (["toggle-pause", "previous", "next"].includes(command)) await control(command);
          if (command === "stop") await stop("button");
          return stateFor(actor, source.page);
        },
      );
      await actor.context.addInitScript(installDemoOverlay, {
        titleToken: actor.titleToken,
      });
      await login(actor);
      actor.videoStartedAt = new Date().toISOString();
      actor.page = await actor.context.newPage();
      actor.video = actor.page.video();
      actor.page.on("close", () => {
        if (!closing) void stop("window-closed");
      });
      actor.page.on("crash", () => {
        if (!closing) void stop("page-crashed");
      });
      browser.on("disconnected", () => {
        if (!closing) void stop("browser-closed");
      });
      const response = await actor.page.goto(win.path);
      if (!response?.ok())
        throw new Error("A demonstration starting page did not load.");
      await actor.page
        .locator("#campusworks-demo-stage")
        .waitFor({ state: "visible" });
      await actor.page.locator("main").waitFor({ state: "visible" });
      await actor.page.waitForFunction(
        () => !!document.querySelector("#__nuxt")?.__vue_app__,
      );
    }
    return stage;
  } catch (error) {
    await stage.close();
    throw error;
  }
}
