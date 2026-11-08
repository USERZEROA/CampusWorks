import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { createLoopService } from "./demo-loop-service.mjs";
import { createDemoStage, DemoStopped } from "./demo-stage.mjs";
import {
  LOOP_STEP_COUNT,
  loopWindows,
  runLoopCycle,
} from "./demo-loop-flow.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profiles = {
  fast: { holdMs: 150, beforeMs: 0, targetMs: 0 },
  normal: { holdMs: 7200, beforeMs: 750, targetMs: 300000 },
  detailed: { holdMs: 12000, beforeMs: 1000, targetMs: 480000 },
};

export async function runDemoLoop({
  headless = false,
  cycles = Infinity,
  pace = "normal",
  build = true,
  verifyControls = false,
  proofPath = ".cache/demo-loop-proof.json",
  onProgress = (message) => console.log(message),
} = {}) {
  if (!Object.hasOwn(profiles, pace))
    throw new Error("Use fast, normal or detailed pacing.");
  if (!(
    cycles === Infinity ||
    (Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= 100)
  ))
    throw new Error(
      "Use one to one hundred rounds, or omit cycles for a continuous presentation.",
    );
  if (headless && !Number.isFinite(cycles))
    throw new Error("Headless checks require a finite cycle count.");
  process.chdir(root);
  mkdirSync(".cache", { recursive: true });
  const statePath = ".cache/demo-loop-state.json";
  const proof = {
    startedAt: new Date().toISOString(),
    synthetic: true,
    headless,
    pace,
    requestedCycles: Number.isFinite(cycles) ? cycles : "continuous",
    providerCalls: 0,
    providerKeyLoaded: false,
    completedCycles: 0,
    cycles: [],
    resets: [],
    stage: [],
    accessibility: [],
    runtimeErrors: [],
    source: Object.fromEntries(
      [
        "scripts/demo-loop.mjs",
        "scripts/demo-loop-flow.mjs",
        "scripts/demo-loop-service.mjs",
        "scripts/demo-stage.mjs",
        "scripts/demo-foreground.ps1",
      ].map((name) => [
        name,
        createHash("sha256").update(readFileSync(name)).digest("hex"),
      ]),
    ),
  };
  let service,
    stage,
    cancelled = false,
    stageCleanupFailed = false;
  const save = () => {
    writeFileSync(resolve(proofPath), JSON.stringify(proof, null, 2) + "\n");
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          launcherPid: process.pid,
          synthetic: true,
          origin: service?.origin,
          database: service?.databaseName,
          windows: stage?.windows.map(({ key, titleToken }) => ({
            key,
            titleToken,
          })),
          completedCycles: proof.completedCycles,
          providerCalls: 0,
          status: proof.status || "running",
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
  };
  const stop = () => {
    cancelled = true;
    void stage?.stop("signal");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    service = await createLoopService({ build, onProgress });
    if (cancelled) throw new DemoStopped();
    proof.origin = service.origin;
    proof.database = service.databaseName;
    stage = await createDemoStage({
      windows: loopWindows(service.manifest),
      baseURL: service.origin,
      headless,
      holdMs: profiles[pace].holdMs,
      beforeMs: profiles[pace].beforeMs,
      totalSteps: LOOP_STEP_COUNT,
      onStop: (reason) => {
        proof.stopReason = reason;
        cancelled = reason !== "page-crashed";
        void stage?.close().catch(() => {
          stageCleanupFailed = true;
        });
      },
      onStep: (receipt) => {
        proof.stage.push(receipt);
        if (!Number.isFinite(cycles) && proof.stage.length > 200)
          proof.stage.splice(0, proof.stage.length - 200);
        save();
      },
    });
    for (const { key, page } of stage.windows) {
      page.on("pageerror", (error) => {
        proof.runtimeErrors.push({ actor: key, message: error.message });
      });
      page.on("dialog", async (dialog) => {
        await dialog.accept();
      });
    }
    if (verifyControls) {
      const admin = stage.page("admin");
      await admin.locator("[data-demo-pause]").click();
      expect(stage.paused).toBe(true);
      let performed = false;
      const blocked = stage.step(
        {
          actor: "admin",
          index: 0,
          title: "Pause verification",
          detail: "The next action waits until Resume.",
        },
        () => {
          performed = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(performed).toBe(false);
      await admin.locator("[data-demo-pause]").click();
      await blocked;
      expect(performed).toBe(true);
      expect(stage.paused).toBe(false);
      proof.pauseResume = "passed";
    }
    onProgress(
      `Automatic lifecycle ready at ${service.origin}. Six independent windows; Pause/Resume or Stop demo in the banner.`,
    );
    save();
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await stage.checkpoint();
      if (cycle > 1) {
        const previous = proof.cycles.at(-1);
        await stage.step(
          {
            actor: "admin",
            index: 0,
            title: "Restore the next demonstration round",
            detail:
              "Only this generated synthetic database is restored. All six identities return to their starting point.",
            cycle,
          },
          async () => {
            await Promise.all(
              stage.windows.map(({ page }) => page.goto("about:blank")),
            );
            await service.reset();
            expect(
              await service.db
                .collection("staffingOpportunities")
                .findOne({ id: previous.positionId }),
            ).toBeNull();
            expect(
              await service.db
                .collection("staffingAppointments")
                .findOne({ id: previous.appointmentId }),
            ).toBeNull();
            expect(await service.db.collection("users").countDocuments()).toBe(
              41,
            );
            await stage.resetSessions();
            proof.resets.push({
              cycle,
              sameDatabase: service.databaseName === proof.database,
              previousPositionAbsent: true,
              previousAppointmentAbsent: true,
              baselineUsers: 41,
              reauthenticatedWindows: 6,
              status: "passed",
            });
            if (!Number.isFinite(cycles) && proof.resets.length > 8)
              proof.resets.shift();
          },
        );
      }
      await stage.setCycle(cycle);
      const record = await runLoopCycle({
        service,
        stage,
        cycle,
        dwell: (ms) => stage.hold(ms),
        onStep: (event) => {
          onProgress(
            `Cycle ${cycle} · ${event.step}/${LOOP_STEP_COUNT} · ${event.role}: ${event.title}`,
          );
        },
      });
      expect(proof.runtimeErrors).toEqual([]);
      if (headless) {
        for (const key of ["applicant", "admin", "instructor"]) {
          const page = stage.page(key);
          const scan = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          expect(scan.violations).toEqual([]);
          proof.accessibility.push({
            cycle,
            actor: key,
            tags: ["wcag2a", "wcag2aa", "wcag21aa"],
            violations: [],
          });
        }
      }
      proof.cycles.push(record);
      proof.completedCycles++;
      if (!Number.isFinite(cycles) && proof.cycles.length > 8)
        proof.cycles.shift();
      save();
      onProgress(
        `Cycle ${cycle} complete: offer, clearance, queue work, feedback, workload, access revocation, settlement and archive all passed.`,
      );
      if (profiles[pace].targetMs)
        await stage.hold(
          Math.max(0, profiles[pace].targetMs - record.durationMs),
        );
    }
    proof.status = "passed";
  } catch (error) {
    if (!service && error.cleanupReceipt)
      proof.startupCleanupReceipt = error.cleanupReceipt;
    const stopReason = proof.stopReason || stage?.stopReason;
    if (stopReason) proof.stopReason = stopReason;
    if (
      stopReason !== "page-crashed" &&
      (error instanceof DemoStopped || cancelled)
    )
      proof.status = "stopped";
    else {
      proof.status = "failed";
      proof.error = String(error.message).slice(0, 4000);
      for (const { key, page } of stage?.windows || []) {
        await page
          .screenshot({
            path: `.cache/demo-loop-failed-${key}.png`,
            fullPage: true,
          })
          .catch(() => {});
      }
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    proof.foregroundCheckCount = stage?.foregroundCheckCount || 0;
    proof.foregroundChecks = stage?.foregroundChecks || [];
    try {
      await stage?.close();
    } catch {
      stageCleanupFailed = true;
    }
    proof.stageCleanupComplete = !stageCleanupFailed;
    try {
      proof.cleanupReceipt = service
        ? await service.close()
        : proof.startupCleanupReceipt;
      proof.cleanup =
        proof.cleanupReceipt?.complete === true && !stageCleanupFailed
          ? "complete"
          : "incomplete";
      if (proof.cleanup === "incomplete") proof.status = "failed";
    } catch {
      proof.cleanup = "incomplete";
      proof.status = "failed";
    }
    proof.finishedAt = new Date().toISOString();
    save();
  }
  return proof;
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--headless") result.headless = true;
    else if (flag === "--skip-build") result.build = false;
    else if (flag === "--verify-controls") result.verifyControls = true;
    else if (flag === "--cycles") result.cycles = Number(args[++i]);
    else if (flag === "--pace") result.pace = args[++i];
    else if (flag === "--help") return null;
    else throw new Error("Unknown automatic demonstration option. Use --help.");
  }
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const chosen = options(process.argv.slice(2));
    if (!chosen)
      console.log(
        "Usage: node scripts/demo-loop.mjs [--pace normal|fast|detailed] [--cycles N] [--headless] [--skip-build] [--verify-controls]\nDefault: continuous visible six-window lifecycle, about five minutes per round. Pause/Resume and Stop demo are in the demo-only banner. Continuous playback never loads a provider Key or purchases AI calls.",
      );
    else {
      const proof = await runDemoLoop(chosen);
      console.log(
        `Automatic demonstration ${proof.status}; cleanup ${proof.cleanup}.`,
      );
      if (proof.status === "failed") {
        console.error(proof.error || "Inspect the local loop receipt.");
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
