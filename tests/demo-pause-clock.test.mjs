import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClock } from '../scripts/demo-stage.mjs';

test('presentation active time excludes a paused interval, including before resume', () => {
  let now = 100;
  const clock = createDemoClock(() => now);
  now = 150;
  assert.equal(clock.elapsedMs, 50);
  clock.setPaused(true);
  now = 9150;
  assert.equal(clock.elapsedMs, 50);
  assert.equal(clock.pausedMs, 9000);
  clock.setPaused(false);
  now = 9200;
  assert.equal(clock.elapsedMs, 100);
  assert.equal(clock.pausedMs, 9000);
});

test('repeated pause and resume requests neither double count nor restart a pause', () => {
  let now = 0;
  const clock = createDemoClock(() => now);
  clock.setPaused(false);
  now = 20;
  clock.setPaused(true);
  now = 80;
  clock.setPaused(true);
  now = 120;
  clock.setPaused(false);
  clock.setPaused(false);
  now = 150;
  clock.setPaused(true);
  now = 190;
  clock.setPaused(false);
  now = 210;
  assert.equal(clock.elapsedMs, 70);
  assert.equal(clock.pausedMs, 140);
});
