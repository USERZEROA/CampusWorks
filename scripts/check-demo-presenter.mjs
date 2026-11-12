import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDemoStage } from './demo-stage.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
mkdirSync('.cache', { recursive: true });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const receipt = {
  scope: 'Isolated local browser presenter controls only; no application database, saved Key, or model call.',
  startedAt: new Date().toISOString(), checks: [], steps: [], businessRequests: [],
};
const server = createServer((request, response) => {
  if (request.url === '/api/auth/mock') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const identity = JSON.parse(body);
      response.setHeader('content-type', 'application/json');
      response.setHeader('set-cookie', `demo_identity=${identity.email}; Path=/; HttpOnly; SameSite=Lax`);
      response.end(JSON.stringify({ user: { email: identity.email } }));
    });
    return;
  }
  if (request.url === '/api/business') {
    receipt.businessRequests.push({ method: request.method, identity: request.headers.cookie });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  const path = request.url.replace(/[<>"&]/g, '');
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><head><title>Presenter fixture ${path}</title>
    <style>body{margin:8px;background:#f3f5fa;color:#172033;font:16px system-ui}main{padding:28px}button,input{padding:12px}h1{font-size:26px}</style>
    </head><body><div id="__nuxt"></div><main><h1>Presenter fixture ${path}</h1>
    <p>Independent local identity and navigation fixture.</p><label for="notes">Notes</label><input id="notes">
    <button id="business" onclick="fetch('/api/business',{method:'POST'})">Example product action</button>
    <a href="/manual-next">Product link</a></main>
    <script>document.getElementById('__nuxt').__vue_app__={};</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const headless = !process.argv.includes('--headed');
receipt.headless = headless;
let stage;
const windows = [
  { key: 'student', as: 'student', email: 'presenter-student@example.com', name: 'Alex Morgan', path: '/start-student' },
  { key: 'teacher', as: 'instructor', email: 'presenter-teacher@example.com', name: 'Prof. Lane', path: '/start-teacher' },
];
const allPages = () => stage.windows.flatMap(item => item.context.pages());
const reviewPages = () => allPages().filter(page => !stage.windows.some(item => item.page === page));
async function reviewAt(path, role) {
  await expect.poll(() => reviewPages().map(page => new URL(page.url()).pathname)).toEqual([path]);
  const page = reviewPages()[0];
  await expect(page.locator('.demo-role')).toHaveText(role);
  return page;
}
async function changeHistory(page, key, path, role) {
  await page.keyboard.press(key);
  return reviewAt(path, role);
}
try {
  stage = await createDemoStage({ windows, baseURL: origin, headless, beforeMs: 0, holdMs: 0, totalSteps: 5, onStep: value => receipt.steps.push(value) });
  const student = stage.page('student');
  const teacher = stage.page('teacher');
  expect((await stage.context('student').cookies()).find(cookie => cookie.name === 'demo_identity')?.value).toBe(windows[0].email);
  expect((await stage.context('teacher').cookies()).find(cookie => cookie.name === 'demo_identity')?.value).toBe(windows[1].email);
  receipt.checks.push('Independent browser identities');

  await student.locator('[data-demo-pause]').click();
  await expect.poll(() => stage.paused).toBe(true);
  let firstRan = false;
  const blocked = stage.step({ actor: 'student', title: 'First completed page', index: 1, durationMs: 150, minViewMs: 40 }, async page => {
    firstRan = true;
    await page.request.post('/api/business');
    await page.goto('/visited-student');
  });
  const activeBefore = stage.activeElapsedMs;
  const pausedBefore = stage.pausedElapsedMs;
  await delay(180);
  expect(firstRan).toBe(false);
  expect(stage.activeElapsedMs - activeBefore).toBeLessThan(50);
  expect(stage.pausedElapsedMs - pausedBefore).toBeGreaterThanOrEqual(160);
  await teacher.locator('[data-demo-pause]').click();
  await blocked;
  expect(stage.paused).toBe(false);
  receipt.checks.push('Pause blocks next action; same button in another window resumes; active clock excludes paused time');

  await stage.step({ actor: 'teacher', title: 'Second completed page', index: 2, durationMs: 200, minViewMs: 70 }, async page => {
    await page.request.post('/api/business');
    await page.goto('/visited-teacher');
  });
  await student.locator('#notes').fill('typed');
  await student.locator('#notes').press('Space');
  await expect(student.locator('#notes')).toHaveValue('typed ');
  await student.locator('#notes').press('ArrowLeft');
  expect(stage.paused).toBe(false);
  expect(reviewPages()).toHaveLength(0);
  await student.evaluate(() => document.activeElement.blur());
  await student.keyboard.press('Control+ArrowLeft');
  expect(reviewPages()).toHaveLength(0);
  await student.keyboard.press('Space');
  await expect.poll(() => stage.paused).toBe(true);
  await student.keyboard.press('Space');
  await expect.poll(() => stage.paused).toBe(false);
  receipt.checks.push('Space toggles; typed spaces and editing arrows do not change playback; modified arrows are ignored');

  let thirdReady;
  const ready = new Promise(resolve => { thirdReady = resolve; });
  const wallBegan = performance.now();
  const third = stage.step({ actor: 'student', role: 'ta', title: 'Current completed TA page', index: 3, durationMs: 700, minViewMs: 150 }, async page => {
    await page.request.post('/api/business');
    await page.goto('/visited-ta');
    thirdReady();
  });
  await ready;
  await delay(100);
  await student.keyboard.press('Pause');
  await expect.poll(() => stage.paused).toBe(true);
  const pausedActive = stage.activeElapsedMs;
  await delay(200);
  expect(stage.activeElapsedMs - pausedActive).toBeLessThan(50);
  expect(receipt.businessRequests).toHaveLength(3);
  let review = await changeHistory(student, 'ArrowLeft', '/visited-teacher', 'Instructor');
  expect(student.url()).toBe(`${origin}/visited-ta`);
  expect(teacher.url()).toBe(`${origin}/visited-teacher`);
  expect(stage.paused).toBe(true);
  expect(receipt.businessRequests).toHaveLength(3);
  review = await changeHistory(review, 'ArrowLeft', '/visited-student', 'Student');
  expect(review.context()).toBe(stage.context('student'));
  review = await changeHistory(review, 'ArrowRight', '/visited-teacher', 'Instructor');
  review = await changeHistory(review, 'ArrowRight', '/visited-ta', 'TA');
  await review.keyboard.press('ArrowRight');
  await delay(120);
  expect(stage.paused).toBe(true);
  expect(receipt.businessRequests).toHaveLength(3);
  expect(reviewPages()).toHaveLength(1);
  receipt.checks.push('Arrows pause and review only visited pages in independent actor tabs; prior Student and current TA roles preserved; latest Next does not run a business action');

  await review.locator('[data-demo-pause]').click();
  await expect.poll(() => stage.paused).toBe(false);
  await third;
  expect(reviewPages()).toHaveLength(0);
  expect(student.url()).toBe(`${origin}/visited-ta`);
  expect(receipt.businessRequests).toHaveLength(3);
  expect(performance.now() - wallBegan).toBeGreaterThan(900);
  const thirdReceipt = receipt.steps.find(step => step.index === 3);
  expect(thirdReceipt.activeDurationMs).toBeGreaterThanOrEqual(650);
  expect(thirdReceipt.viewHoldMs).toBeGreaterThanOrEqual(150);
  receipt.checks.push('Resume returns to intact automation page without replay and preserves the remaining dwell interval');

  await student.evaluate(async () => {
    await Promise.all(Array.from({ length: 8 }, () => window.__campusworksDemoCommand('toggle-pause')));
  });
  await expect.poll(() => stage.paused).toBe(false);
  for (const page of [student, teacher]) await expect(page.locator('[data-demo-pause]')).toHaveText('Pause');
  receipt.checks.push('Rapid even pause toggles remain synchronized across identities');

  await stage.step({ actor: 'teacher', title: 'Slow response still receives readable result time', index: 4, durationMs: 180, minViewMs: 130 }, async () => delay(220));
  const slowReceipt = receipt.steps.find(step => step.index === 4);
  expect(slowReceipt.actionDurationMs).toBeGreaterThanOrEqual(200);
  expect(slowReceipt.viewHoldMs).toBeGreaterThanOrEqual(130);
  expect(slowReceipt.activeDurationMs).toBeGreaterThanOrEqual(slowReceipt.actionDurationMs + 110);
  receipt.checks.push('A slow result retains its minimum reading interval instead of consuming the planned view time');

  await teacher.evaluate(async () => {
    await Promise.all(['previous', 'next', 'toggle-pause'].map(command => window.__campusworksDemoCommand(command)));
  });
  await expect.poll(() => stage.paused).toBe(false);
  await expect.poll(() => reviewPages().length).toBe(0);
  expect(receipt.businessRequests).toHaveLength(3);
  expect(student.url()).toBe(`${origin}/visited-ta`);
  expect(teacher.url()).toBe(`${origin}/visited-teacher`);
  for (const page of [student, teacher]) await expect(page.locator('[data-demo-pause]')).toHaveText('Pause');
  receipt.checks.push('Concurrent previous-next-resume commands serialize without stale review focus, orphan tabs or action replay');

  const axe = await new AxeBuilder({ page: teacher }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  receipt.checks.push('Presentation control overlay has zero configured Axe violations');
  receipt.foregroundChecks = stage.foregroundChecks;
  if (!headless) expect(receipt.foregroundChecks.every(check => check.confirmed && check.maximized)).toBe(true);

  await stage.close();
  stage = await createDemoStage({ windows, baseURL: origin, headless, manual: true, beforeMs: 0, holdMs: 0, totalSteps: 4 });
  const manualStudent = stage.page('student');
  const manualTeacher = stage.page('teacher');
  let manualActions = 0;
  const firstManual = stage.step({ actor: 'student', title: 'Keyboard first step', index: 1 }, async page => {
    manualActions++;
    await page.request.post('/api/business');
    await page.goto('/manual-first');
  });
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await delay(150);
  expect(manualActions).toBe(0);
  await manualStudent.locator('#notes').press('ArrowRight');
  expect(manualActions).toBe(0);
  await manualStudent.evaluate(() => document.activeElement.blur());
  await manualStudent.keyboard.press('Pause');
  await expect.poll(() => stage.paused).toBe(true);
  await manualStudent.keyboard.press('ArrowRight');
  await delay(100);
  expect(manualActions).toBe(0);
  await manualTeacher.keyboard.press('Space');
  await expect.poll(() => stage.paused).toBe(false);
  await delay(100);
  expect(manualActions).toBe(0);
  await manualTeacher.keyboard.press('ArrowRight');
  await firstManual;
  expect(manualActions).toBe(1);
  receipt.checks.push('Keyboard mode waits indefinitely; editing arrows and paused Next do not execute; Resume alone never advances');

  let unblock;
  let entered;
  const actionReady = new Promise(resolve => { entered = resolve; });
  const actionHeld = new Promise(resolve => { unblock = resolve; });
  const secondManual = stage.step({ actor: 'teacher', title: 'Keyboard second step', index: 2 }, async page => {
    entered();
    await actionHeld;
    manualActions++;
    await page.request.post('/api/business');
    await page.goto('/manual-second');
  });
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await manualStudent.keyboard.press('ArrowRight');
  await actionReady;
  await manualStudent.evaluate(async () => {
    await Promise.all(Array.from({ length: 8 }, () => window.__campusworksDemoCommand('next')));
  });
  unblock();
  await secondManual;
  const thirdManual = stage.step({ actor: 'student', title: 'Keyboard third step', index: 3 }, async page => {
    manualActions++;
    await page.request.post('/api/business');
    await page.goto('/manual-third');
  });
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await delay(150);
  expect(manualActions).toBe(2);
  receipt.checks.push('Repeated Next during an action cannot queue or approve a future step');

  let manualReview = await changeHistory(manualTeacher, 'ArrowLeft', '/manual-first', 'Student');
  manualReview = await changeHistory(manualReview, 'ArrowRight', '/manual-second', 'Instructor');
  await manualReview.keyboard.press('ArrowRight');
  await expect.poll(() => reviewPages().length).toBe(0);
  await expect.poll(() => stage.paused).toBe(false);
  await delay(150);
  expect(manualActions).toBe(2);
  await manualTeacher.keyboard.press('ArrowRight');
  await thirdManual;
  expect(manualActions).toBe(3);
  receipt.checks.push('Previous reviews current authorized pages; returning to the latest page neither replays actions nor advances the pending step');

  let resetRan = false;
  const resetManual = stage.step({ actor: 'teacher', title: 'Keyboard round reset', index: 0 }, () => { resetRan = true; });
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await delay(100);
  expect(resetRan).toBe(false);
  await manualStudent.keyboard.press('ArrowRight');
  await resetManual;
  expect(resetRan).toBe(true);
  receipt.checks.push('Starting another round also requires a separate keyboard advance');

  const manualAxe = await new AxeBuilder({ page: manualTeacher }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(manualAxe.violations).toEqual([]);
  const stoppedManual = stage.step({ actor: 'student', title: 'Never run after Stop', index: 4 }, () => { throw new Error('Stopped step ran'); });
  const stoppedOutcome = stoppedManual.then(() => ({ ran: true }), error => ({ name: error.name }));
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await stage.stop('verification');
  expect(await stoppedOutcome).toEqual({ name: 'DemoStopped' });
  receipt.checks.push('Keyboard overlay passes configured Axe checks; stopping cancels a waiting step');

  await stage.close();
  stage = await createDemoStage({ windows: [windows[0]], baseURL: origin, headless, manual: true, beforeMs: 0, holdMs: 0, totalSteps: 2 });
  const racePage = stage.page('student');
  let finishFirst;
  let signalFirst;
  const firstEntered = new Promise(resolve => { signalFirst = resolve; });
  const firstHeld = new Promise(resolve => { finishFirst = resolve; });
  const queuedFirst = stage.step({ actor: 'student', title: 'Busy control queue', index: 1 }, async () => {
    signalFirst();
    await firstHeld;
  });
  await expect(racePage.locator('[data-demo-next]')).toBeEnabled();
  await racePage.evaluate(() => {
    const render = window.__campusworksDemoRender;
    let holdFirst = true;
    window.__campusworksDemoRender = async state => {
      if (holdFirst) {
        holdFirst = false;
        await new Promise(resolve => { window.releaseDemoRender = resolve; });
      }
      return render(state);
    };
  });
  const firstAdvance = stage.next();
  await firstEntered;
  const staleAdvance = stage.next();
  finishFirst();
  await queuedFirst;
  let queuedSecondRan = false;
  const queuedSecond = stage.step({ actor: 'student', title: 'Needs a fresh key', index: 2 }, () => { queuedSecondRan = true; });
  await expect.poll(() => stage.waitingForAdvance).toBe(true);
  await racePage.evaluate(() => window.releaseDemoRender());
  await Promise.all([firstAdvance, staleAdvance]);
  await delay(150);
  expect(queuedSecondRan).toBe(false);
  await racePage.keyboard.press('ArrowRight');
  await queuedSecond;
  expect(queuedSecondRan).toBe(true);
  receipt.checks.push('A key received during an action remains ignored even when its control callback runs after the next step becomes ready');
  receipt.status = 'passed';
} catch (error) {
  receipt.status = 'failed';
  receipt.error = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await stage?.close();
  await new Promise(resolve => server.close(resolve));
  receipt.cleanup = 'complete';
  receipt.finishedAt = new Date().toISOString();
  await writeFile(`.cache/demo-presenter-race-${headless ? 'headless' : 'headed'}-proof.json`, JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ status: receipt.status, checks: receipt.checks.length, businessRequests: receipt.businessRequests.length, cleanup: receipt.cleanup }));
