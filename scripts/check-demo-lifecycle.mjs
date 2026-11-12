import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLoopService } from './demo-loop-service.mjs';
import { createDemoStage } from './demo-stage.mjs';
import { loopWindows, runLoopCycle, loopStepCount } from './demo-loop-flow.mjs';
import { createDemoPacing } from './demo-pacing.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
mkdirSync('.cache', { recursive: true });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const receipt = {
  startedAt: new Date().toISOString(),
  scope: 'Headless isolated synthetic workflows: one automatic round and two keyboard rounds; no provider calls or live presentation state changes.',
  providerCalls: 0, steps: [], rounds: [], resets: [], runtimeErrors: [],
};
const pacing = createDemoPacing({ pace: 'fast', withAi: false });
let service, stage;

async function finish(work, manual) {
  let settled = false, result, failure;
  const observed = work.then(value => { result = value; settled = true; }, error => { failure = error; settled = true; });
  const deadline = Date.now() + 180000;
  while (!settled) {
    if (Date.now() > deadline) {
      await stage.stop('verification-timeout');
      await observed;
      throw new Error('The isolated lifecycle did not finish within three minutes.');
    }
    if (manual && stage.waitingForAdvance && !stage.paused) await stage.next();
    await pause(30);
  }
  await observed;
  if (failure) throw failure;
  return result;
}

try {
  service = await createLoopService({ build: false, provider: 'disabled' });
  for (const manual of [false, true]) {
    if (manual) {
      const reset = await service.reset();
      assert.equal(reset.generation, 1);
    }
    stage = await createDemoStage({
      windows: loopWindows(service.manifest), baseURL: service.origin,
      headless: true, manual, beforeMs: 0, holdMs: 0, totalSteps: loopStepCount(false),
      onStep: step => receipt.steps.push({ manual, cycle: step.cycle, index: step.index, actor: step.actor }),
    });
    const originalBrowsers = stage.windows.map(window => window.browser);
    for (const { key, page } of stage.windows) {
      page.on('pageerror', error => receipt.runtimeErrors.push({ actor: key, message: error.message }));
      page.on('dialog', dialog => dialog.accept());
    }
    let previous;
    for (let cycle = 1; cycle <= (manual ? 2 : 1); cycle++) {
      if (cycle > 1) {
        await finish(stage.step({ actor: 'admin', index: 0, cycle, title: 'Reset only after keyboard advance' }, async () => {
          await Promise.all(stage.windows.map(({ page }) => page.goto('about:blank')));
          await service.reset();
          assert.equal(await service.db.collection('staffingOpportunities').findOne({ id: previous.positionId }), null);
          assert.equal(await service.db.collection('staffingAppointments').findOne({ id: previous.appointmentId }), null);
          assert.equal(await service.db.collection('users').countDocuments(), 41);
          await stage.resetSessions();
        }), manual);
        receipt.resets.push({ cycle, priorRecordsRemoved: true, reauthenticatedWindows: 6 });
      }
      await stage.setCycle(cycle);
      previous = await finish(runLoopCycle({ service, stage, cycle, pacing, dwell: milliseconds => stage.hold(milliseconds) }), manual);
      assert.equal(receipt.steps.filter(step => step.manual === manual && step.cycle === cycle && step.index > 0).length, 33);
      assert.deepEqual(stage.windows.map(window => window.browser), originalBrowsers);
      assert.deepEqual(receipt.runtimeErrors, []);
      receipt.rounds.push({ mode: manual ? 'keyboard' : 'automatic', cycle, steps: 33, sameSixWindows: true, status: 'passed' });
    }
    await stage.close();
    stage = undefined;
  }
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed';
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  try { await stage?.close(); } catch { receipt.status = 'failed'; process.exitCode = 1; }
  try {
    receipt.cleanup = await service?.close();
    if (!receipt.cleanup?.complete) { receipt.status = 'failed'; process.exitCode = 1; }
  } catch { receipt.status = 'failed'; process.exitCode = 1; }
  receipt.finishedAt = new Date().toISOString();
  writeFileSync('.cache/demo-lifecycle-headless-proof.json', JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ status: receipt.status, rounds: receipt.rounds, runtimeErrors: receipt.runtimeErrors.length, providerCalls: receipt.providerCalls, cleanup: receipt.cleanup?.complete, error: receipt.error }));
