import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDemoLoop } from './demo-loop.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const directory = resolve(root, '.cache/submission-export/video/source');
mkdirSync(directory, { recursive: true });
const proof = await runDemoLoop({
  provider: 'disabled', headless: true, cycles: 1, pace: 'normal',
  build: !process.argv.includes('--skip-build'),
  proofPath: '.cache/submission-export/video/lifecycle-recording.json',
  recordVideoDirectory: directory,
});
if (proof.status !== 'passed' || proof.cleanup !== 'complete') {
  process.exitCode = 1;
} else {
  writeFileSync(resolve(directory, 'recordings.json'), JSON.stringify({
    scope: 'Actual local product interactions with synthetic records; no AI requests. Saved real OpenAI panels are separate, explicitly labeled media.',
    recordings: proof.recordings, scenes: proof.stage,
  }, null, 2)+'\n');
  console.log('Recorded the complete local lifecycle for submission editing.');
}
