import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(root, '.cache/submission-export');
const work = resolve(output, 'video/assembly');
const recordingPath = resolve(output, 'video/lifecycle-recording.json');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const local = path => relative(root, path).split(sep).join('/');
const image = path => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const narration = [
  'An administrator opens one shared recruitment cycle for everyone.',
  'The instructor sets course duties and weekly hours.',
  'Qualifications and screening questions describe the evidence applicants should provide.',
  'An administrator approves the opening before students can apply.',
  'Alex finds the course opening as an ordinary student.',
  'Academic preparation, availability, and answers stay with the application.',
  'Alex attaches a synthetic CV and submits the reviewed application.',
  'The same applicant can express interest in another course.',
  'A second instructor reviews Alex for a different opening.',
  "The reviewer inspects Alex's submitted qualifications and screening answers.",
  'The instructor shortlists Alex and issues an offer.',
  'Other instructors now see that Alex is no longer available.',
  'Alex accepts the offer. Course access still waits for clearance.',
  'The administrator records clearance for the accepted appointment.',
  'The same account now gains the correct course assistant tools.',
  'Alex starts duty before operating the live queue.',
  'The team posts an announcement with a labeled Zoom example.',
  'Sam enrolls in the course before asking for help.',
  'Sam adds a question and location to the queue.',
  "Alex claims Sam's request, making the assigned helper visible.",
  'Sam can see which assistant is providing help.',
  'Alex completes the session, retaining its history.',
  'Sam links feedback to the actual completed session and helper.',
  'Alex reports teaching work that happens beyond the queue.',
  'The instructor reviews observed support and attributed student feedback.',
  'The team closes the queue when office hours end.',
  'Alex still has assistant access before the appointment is ended.',
  'The instructor ends the appointment with a recorded reason.',
  'Assistant tools disappear. Alex keeps student access.',
  'Course review brings demand, work reports, and staffing evidence together.',
  'The department compares course demand, coverage, and feedback sample counts.',
  'The instructor archives the completed opening.',
  'Alex keeps application history after the full teaching lifecycle.',
];

const ai = new Map([
  [4, { id: 'ai-requirements', title: 'Requirements with evidence', source: 'showcase-ai-requirements-desktop.png', narration: 'This saved OpenAI example suggests qualification focused wording. It is advice for the instructor, not an automatic edit.' }],
  [10, { id: 'ai-qualifications', title: 'Preparation and evidence gaps', source: 'showcase-ai-summary-desktop.png', narration: 'A saved real response summarizes typed qualifications and missing evidence, with references to the submitted application.' }],
  [12, { id: 'ai-eligible-alternatives', title: 'Current eligible alternatives', source: 'showcase-ai-candidates-desktop.png', crop: 220, narration: 'After Alex is reserved elsewhere, this recorded response compares eligible alternatives. Its coverage is one candidate page, rather than an overall ranking.' }],
  [30, { id: 'ai-course-advice', title: 'Context for the next cycle', source: 'showcase-ai-course-review-desktop.png', narration: 'This recorded course advice connects observed demand, reported work, and staffing coverage, while keeping the limits of that evidence visible.' }],
]);

const probe = path => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { encoding: 'utf8', windowsHide: true }));
async function command(name, args, logName) {
  const fd = openSync(resolve(work, logName), 'w');
  try {
    const code = await new Promise((done, reject) => {
      const child = spawn(name, args, { cwd: root, windowsHide: true, stdio: ['ignore', fd, fd] });
      child.once('error', reject); child.once('exit', done);
    });
    if (code !== 0) throw new Error(`${name} failed; inspect ${local(resolve(work, logName))}.`);
  } finally { closeSync(fd); }
}

function sceneHtml(segment, position, total, demoUrl) {
  const label = segment.type === 'ai' ? 'SAVED REAL OPENAI EXAMPLE' : segment.type === 'workflow' ? segment.role.toUpperCase() : 'PRODUCT WALKTHROUGH';
  const footer = segment.type === 'ai' ? 'Earlier actual response\nSynthetic evidence · Human decision' : 'Actual local product recording\nSynthetic records · No desktop capture';
  let right = '';
  if (segment.type === 'intro') right = `<div class="cover"><div class="eyebrow">FOUR ROLES · ONE CONNECTED WORKFLOW</div><h2>Apply.<br>Appoint.<br>Support.</h2><p>TA / RA recruitment → accepted and cleared appointments → student support → course evidence.</p><div class="roles"><span>Student</span><span>TA</span><span>Instructor</span><span>Administrator</span></div><div class="counts"><div><b>10</b>demo courses</div><div><b>21</b>openings</div><div><b>68</b>applications</div></div></div>`;
  if (segment.type === 'outro') right = `<div class="cover final"><div class="eyebrow">FROM APPLICATION TO STUDENT SUPPORT</div><h2>Explore the<br>complete journey.</h2><p>Choose a role in the public browser experience.<br>Its synthetic data stays in your browser.</p><div class="roles"><span>Student</span><span>TA</span><span>Instructor</span><span>Administrator</span></div><p class="link">${escape(demoUrl || 'CampusWorks')}</p><p class="boundary">Browser experience: local synthetic state + saved AI examples.<br>Full application: server-backed workflows + live AI with a private Key.</p></div>`;
  if (segment.type === 'ai') {
    const path = resolve(root, 'docs/demo/screenshots', segment.source);
    const bytes = readFileSync(path); const tall = bytes.readUInt32BE(20) > 1500;
    right = `<div class="ai-image ${tall ? 'tall' : 'fit'}"><img src="${image(path)}" alt="Saved actual OpenAI response" style="${tall ? `top:-${(segment.crop || 0) * 1440 / 1802}px` : ''}"></div>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(segment.title)}</title><style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif;background:#012169;color:white}.left{position:absolute;left:38px;top:38px;width:360px;height:1004px}.logo{width:285px;height:auto}.brand{font-size:38px;font-weight:750;letter-spacing:-1px;margin:22px 0 48px}.label{display:inline-block;border:1px solid #92b7ff;border-radius:7px;padding:10px 12px;font-size:15px;font-weight:700;letter-spacing:1px;line-height:1.5;color:#e0ecff;max-width:350px}.title{font-size:37px;line-height:1.2;font-weight:720;letter-spacing:-.8px;margin:28px 0 20px}.detail{font-size:23px;line-height:1.5;color:#d6e4ff;margin:0}.footer{position:absolute;bottom:58px;font-size:15px;line-height:1.6;color:#bfd2f5;white-space:pre-line}.position{position:absolute;bottom:8px;font-size:16px;font-weight:650;color:#e7efff}.line{position:absolute;bottom:0;left:0;width:350px;height:4px;background:#345998}.line span{display:block;width:${Math.round((position+1)/total*100)}%;height:4px;background:#00d1b2}.screen{position:absolute;left:440px;top:40px;width:1440px;height:1000px;background:#f6f8fc;border-radius:13px;overflow:hidden;border:1px solid #6181b8}.cover{width:1440px;height:1000px;background:radial-gradient(ellipse at 90% 30%,#dce8ff,transparent 65%),#f4f7fd;color:#10213b;padding:78px 72px}.eyebrow{font-size:21px;font-weight:700;letter-spacing:2px;color:#1a4888}.cover h2{font-size:112px;line-height:1.02;letter-spacing:-4px;margin:30px 0 26px;color:#012169}.cover p{font-size:31px;line-height:1.45;max-width:1180px;color:#4b6080}.roles{display:flex;gap:17px;margin-top:30px;flex-wrap:wrap}.roles span{padding:14px 24px;background:#e1eafa;color:#173e7a;border:1px solid #b8cae9;border-radius:40px;font-size:24px;font-weight:650}.counts{display:flex;gap:28px;margin-top:42px}.counts div{background:#fff;border-left:4px solid #1e4e98;border-radius:10px;padding:16px 27px;font-size:22px;min-width:215px;color:#526784}.counts b{display:block;font-size:54px;color:#012169}.final h2{font-size:96px;margin-top:42px}.final .link{font-size:32px;color:#012169;font-weight:700;margin-top:52px;overflow-wrap:anywhere}.final .boundary{font-size:22px;margin-top:25px;line-height:1.5}.ai-image{position:relative;width:1440px;height:1000px;overflow:hidden;background:white}.ai-image img{display:block;width:1440px;height:auto;position:absolute;left:0}.ai-image.fit{display:flex;align-items:center;justify-content:center}.ai-image.fit img{position:static;width:1440px;height:1000px;object-fit:contain}</style></head><body><aside class="left"><img class="logo" src="${image(resolve(root,'public/duke-cs-logo.png'))}" alt="Duke Computer Science"><div class="brand">CampusWorks</div><div class="label">${escape(label)}</div><h1 class="title">${escape(segment.title)}</h1><p class="detail">${escape(segment.detail)}</p><div class="footer">${escape(footer)}</div><div class="position">${segment.type === 'workflow' ? `PRODUCT STEP ${String(segment.step).padStart(2,'0')} / 33` : `SCENE ${position+1} / ${total}`}</div><div class="line"><span></span></div></aside><main class="screen">${right}</main></body></html>`;
}

function srtTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2,'0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2,'0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2,'0')},${String(milliseconds % 1000).padStart(3,'0')}`;
}

async function main() {
  process.chdir(root);
  let demoUrl = '';
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--demo-url') throw new Error('Use --demo-url with a verified public HTTPS address.');
    const parsed = new URL(args[1]);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use a public HTTPS URL without credentials, query or fragment.');
    demoUrl = parsed.href;
  }
  mkdirSync(work, { recursive: true });
  const recording = JSON.parse(readFileSync(recordingPath, 'utf8'));
  assert.equal(recording.status, 'passed'); assert.equal(recording.cleanup, 'complete');
  assert.equal(recording.providerCalls, 0); assert.equal(recording.providerKeyLoaded, false);
  assert.equal(recording.stage.length, 33); assert.equal(recording.recordings.length, 6);
  const sources = new Map(recording.recordings.map(item => [item.actor, item]));
  const segments = [{ id:'intro',type:'intro',duration:8,title:'From application to student support.',detail:'A connected workflow for students, TAs, instructors and administrators.',narration:'CampusWorks connects assistant applications, appointments, course support, and evidence for the next teaching cycle.' }];
  for (const [index, scene] of recording.stage.entries()) {
    const source = sources.get(scene.actor);
    assert.ok(source && existsSync(source.path));
    const offset = (Date.parse(scene.startedAt) - Date.parse(source.startedAt)) / 1000;
    const available = (Date.parse(scene.completedAt) - Date.parse(scene.startedAt)) / 1000;
    assert.ok(offset >= 0 && available > 0);
    segments.push({ id:`step-${String(index+1).padStart(2,'0')}`,type:'workflow',step:index+1,actor:scene.actor,role:scene.role,title:scene.title,detail:scene.detail,duration:4,narration:narration[index],recording:source.path,sourceOffset:offset,sourceDuration:available,
      portions: available > 4 ? [{offset:offset + .06,duration:2},{offset:offset + available - 2.06,duration:2}] : [{offset:offset + .04,duration:Math.max(.1,available-.08)}] });
    if (ai.has(index+1)) { const example=ai.get(index+1); segments.push({ ...example,type:'ai',duration:8,detail:'Saved real OpenAI response on synthetic evidence. No new request is made in this video.' }); }
  }
  segments.push({id:'outro',type:'outro',duration:8,title:'Explore the complete journey.',detail:'Choose an identity and try the browser experience.',narration:'Explore four roles in your own browser. The public experience uses synthetic local data and saved AI examples. Live AI belongs in the full application.'});
  assert.equal(segments.reduce((sum,segment)=>sum+segment.duration,0),180);
  let elapsed = 0; for (const segment of segments) { segment.start=elapsed; elapsed+=segment.duration; segment.end=elapsed; }
  const planPath=resolve(work,'plan.json');
  writeFileSync(planPath,JSON.stringify({segments},null,2)+'\n');
  await command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/submission-narration.ps1'),'-PlanPath',planPath,'-OutputDirectory',resolve(work,'speech')],'speech.log');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    for (const [index,segment] of segments.entries()) {
      segment.frame=resolve(work,`${segment.id}.png`);
      await page.setContent(sceneHtml(segment,index,segments.length,demoUrl),{waitUntil:'load'});
      await page.locator('img').evaluateAll(images=>Promise.all(images.map(item=>item.decode())));
      await page.screenshot({path:segment.frame});
    }
  } finally { await browser.close(); }
  const tasks=segments.map(segment=>async()=>{
    const rawAudio=resolve(work,'speech',`${segment.id}.wav`);
    const rawDuration=Number(probe(rawAudio).format.duration);
    const tempo=Math.max(1,rawDuration/(segment.duration-.25));
    if(tempo>1.4)throw new Error(`Shorten narration before encoding ${segment.id}; required audio speed is too high.`);
    segment.narrationSourceDuration=rawDuration;segment.narrationTempo=tempo;
    segment.audio=resolve(work,`${segment.id}-audio.wav`);
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',rawAudio,'-af',`atempo=${tempo.toFixed(5)},apad,atrim=duration=${segment.duration},afade=t=out:st=${segment.duration-.10}:d=0.10`,'-ar','48000','-ac','1','-c:a','pcm_s16le',segment.audio],`${segment.id}-audio.log`);
    segment.video=resolve(work,`${segment.id}.mp4`);
    const input=['-hide_banner','-loglevel','error','-y','-loop','1','-framerate','25','-i',segment.frame];
    let filters;
    if(segment.type==='workflow') {
      for(const part of segment.portions)input.push('-ss',part.offset.toFixed(3),'-i',segment.recording);
      const productViewport='crop=1440:888:0:112,pad=1440:1000:0:0:color=0xf6f8fc,setsar=1';
      if(segment.portions.length===2)filters=`[1:v]trim=duration=2,setpts=PTS-STARTPTS,fps=25,${productViewport}[a];[2:v]trim=duration=2,setpts=PTS-STARTPTS,fps=25,${productViewport}[b];[a][b]concat=n=2:v=1:a=0[screen];[0:v][screen]overlay=440:40:shortest=1,format=yuv420p[v]`;
      else filters=`[1:v]trim=duration=${segment.portions[0].duration.toFixed(3)},setpts=PTS-STARTPTS,fps=25,${productViewport},tpad=stop_mode=clone:stop_duration=4[screen];[0:v][screen]overlay=440:40:shortest=1,format=yuv420p[v]`;
      input.push('-filter_complex',filters,'-map','[v]');
    } else input.push('-vf','format=yuv420p','-map','0:v');
    input.push('-an','-t',String(segment.duration),'-r','25','-c:v','libx264','-preset','veryfast','-crf','20','-profile:v','high','-level','4.0','-g','50','-keyint_min','25','-pix_fmt','yuv420p','-threads','2',segment.video);
    await command('ffmpeg',input,`${segment.id}-video.log`);
    console.log(`${segment.id}: ${segment.duration}s video, narration ${rawDuration.toFixed(2)}s at ${tempo.toFixed(2)}x`);
  });
  for(let index=0;index<tasks.length;index+=2)await Promise.all(tasks.slice(index,index+2).map(task=>task()));
  const concatLine=path=>`file '${path.replaceAll('\\','/').replaceAll("'","'\\''")}'`;
  const videoList=resolve(work,'videos.txt'),audioList=resolve(work,'audio.txt');
  writeFileSync(videoList,segments.map(segment=>concatLine(segment.video)).join('\n')+'\n');
  writeFileSync(audioList,segments.map(segment=>concatLine(segment.audio)).join('\n')+'\n');
  const combinedAudio=resolve(work,'narration.wav');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',audioList,'-c:a','pcm_s16le',combinedAudio],'combined-audio.log');
  const movie=resolve(output,'CampusWorks-demo-3min.mp4');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',videoList,'-i',combinedAudio,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-t','180','-movflags','+faststart',movie],'final-video.log');
  const metadata=probe(movie); const video=metadata.streams.find(stream=>stream.codec_type==='video'),audio=metadata.streams.find(stream=>stream.codec_type==='audio');
  assert.equal(video.codec_name,'h264'); assert.equal(video.width,1920); assert.equal(video.height,1080); assert.equal(audio.codec_name,'aac'); assert.ok(Math.abs(Number(metadata.format.duration)-180)<.15);
  const subtitles=segments.map((segment,index)=>`${index+1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.narration}\n`).join('\n');
  writeFileSync(resolve(output,'CampusWorks-demo-subtitles.srt'),subtitles);
  const prerequisites='Reproduction prerequisites: Windows with an enabled English System.Speech voice; FFmpeg and ffprobe on PATH with libx264 and AAC support; installed project dependencies and Playwright Chromium; installed Chrome or Edge for the final MP4 playback check. Rendering does not need an API Key.';
  const outputs='Outputs under `.cache/submission-export/`: `CampusWorks-demo-3min.mp4`, `CampusWorks-demo-subtitles.srt`, `video-manifest.json` and `video-contact-sheet.png`. The manifest records source hashes and successful full decoding, audible narration and browser playback. The video crops the presentation-only banner from recorded business scenes; correctly timed role captions appear on the left and product UI pixels retain their original size.';
  const transcript=`# CampusWorks video script\n\nDuration: 3 minutes. Actual local browser recording with synthetic data; business scenes do not call AI. Four inserted panels are explicitly labeled saved real OpenAI examples, with earlier provider provenance retained in the project. No desktop or Key window is recorded. Narration uses an offline English Windows voice.\n\n${prerequisites}\n\nGenerate with \`node scripts/submission-video.mjs\`. The source lifecycle recording must already exist under \`.cache/submission-export/video/\`. Optionally use \`--demo-url\` only after the public HTTPS link is verified. Upload the MP4 to your own YouTube or Vimeo account and paste its URL into the submission form.\n\n${outputs}\n\n| Time | Scene | Narration |\n| --- | --- | --- |\n${segments.map(segment=>`| ${srtTime(segment.start).slice(3,8)}–${srtTime(segment.end).slice(3,8)} | ${segment.type==='ai'?'Saved OpenAI example: ':''}${segment.title} | ${segment.narration} |`).join('\n')}\n`;
  writeFileSync(resolve(root,'docs/submission/VIDEO_SCRIPT.md'),transcript);
  const sourceRecordings=recording.recordings.map(item=>({actor:item.actor,path:local(item.path),sha256:sha(item.path),startedAt:item.startedAt,probe:probe(item.path).streams.map(stream=>({codec:stream.codec_name,width:stream.width,height:stream.height}))}));
  const manifest={status:'passed',recordedAt:new Date().toISOString(),durationSeconds:Number(metadata.format.duration),video:{path:local(movie),sha256:sha(movie),bytes:readFileSync(movie).length,codec:video.codec_name,width:video.width,height:video.height,frameRate:video.r_frame_rate},audio:{codec:audio.codec_name,sampleRate:audio.sample_rate,channels:audio.channels,offlineNarration:JSON.parse(readFileSync(resolve(work,'speech/narration-source.json'),'utf8').replace(/^\uFEFF/,''))},recordingReceipt:{path:local(recordingPath),sha256:sha(recordingPath),providerCalls:0,productSteps:33},sourceRecordings,savedAIProvenance:{path:'docs/verification/staffing-live-ai-capture-provenance.json',sha256:sha(resolve(root,'docs/verification/staffing-live-ai-capture-provenance.json'))},segments:segments.map(({frame,audio,video,...segment})=>({...segment,frame:local(frame),normalizedAudio:local(audio),encodedVideo:local(video),...(segment.type==='ai'?{sourcePath:`docs/demo/screenshots/${segment.source}`,sourceSha256:sha(resolve(root,'docs/demo/screenshots',segment.source))}:{})})),boundaries:['Edited recording of actual local product controls with synthetic records. Source clips use scene timestamps and only the corresponding recorded identity.','Each business scene shows its first and final two seconds, or the full shorter scene plus a held final frame. This editing does not execute or repeat product operations.','Four actual OpenAI example panels are saved prior responses, not model calls made during this recording. No API Key is present in video frames or narration.','The public GitHub Pages experience uses local browser state and saved AI examples; it is not the hosted MongoDB application or an exposed AI endpoint.']};
  manifest.status='verification pending';
  writeFileSync(resolve(output,'video-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const checkDirectory=resolve(output,'video/checks');mkdirSync(checkDirectory,{recursive:true});
  const samples=[2,15.6,28,60,76,87.6,95.6,115.6,131.6,156,163.6,167.6,176];
  for(const [index,time]of samples.entries())await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',movie,'-frames:v','1',resolve(checkDirectory,`sample-${String(index+1).padStart(2,'0')}-${time}s.png`)],`sample-${index}.log`);
  const sampledFrames=[];
  for (const [index,segment] of segments.entries()) {
    const timestamp=segment.type==='workflow'?segment.end-.4:segment.start+segment.duration/2;
    const path=resolve(checkDirectory,`scene-${String(index+1).padStart(2,'0')}-${segment.id}.png`);
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(timestamp),'-i',movie,'-frames:v','1',path],`scene-${index}-sample.log`);
    const thumbnail=resolve(checkDirectory,`thumb-${segment.id}.png`);
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',path,'-vf','scale=432:243','-frames:v','1',thumbnail],`scene-${index}-thumbnail.log`);
    sampledFrames.push({scene:segment.id,time:timestamp,path:local(path),thumbnail:local(thumbnail),title:segment.title});
  }
  await command('ffmpeg',['-hide_banner','-loglevel','error','-xerror','-i',movie,'-f','null','-'],'decode-check.log');
  await command('ffmpeg',['-hide_banner','-i',movie,'-vn','-af','volumedetect','-f','null','-'],'audio-check.log');
  const audioLog=readFileSync(resolve(work,'audio-check.log'),'utf8');
  const meanVolume=Number(audioLog.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
  const peakVolume=Number(audioLog.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
  assert.ok(Number.isFinite(meanVolume)&&meanVolume>-50&&peakVolume>-20,'Narration must contain audible speech.');
  const sheet=resolve(output,'video-contact-sheet.png');
  const reviewBrowser=await chromium.launch({channel:'chrome',headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));
  try {
    const page=await reviewBrowser.newPage({viewport:{width:1800,height:3140},deviceScaleFactor:1});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#eef3fc;color:#012169;font:16px "Segoe UI",sans-serif;padding:24px}h1{font-size:32px;margin:0 0 8px}p{margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card{background:white;border:1px solid #c3d0e6;border-radius:8px;overflow:hidden}.card img{display:block;width:100%;height:auto}.caption{padding:9px 11px;font-size:15px;min-height:48px}</style></head><body><h1>CampusWorks · 3-minute video review</h1><p>All 39 scene samples from the encoded H.264/AAC movie · Actual workflow + four labeled saved real OpenAI examples</p><div class="grid">${sampledFrames.map((sample,index)=>`<div class="card"><img src="${image(resolve(root,sample.thumbnail))}"><div class="caption">${String(index+1).padStart(2,'0')} · ${srtTime(sample.time).slice(3,8)} · ${escape(sample.title)}</div></div>`).join('')}</div></body></html>`,{waitUntil:'load'});
    await page.locator('img').evaluateAll(images=>Promise.all(images.map(item=>item.decode())));
    await page.screenshot({path:sheet,fullPage:true});
    const player=resolve(checkDirectory,'player.html');
    writeFileSync(player,`<!doctype html><html><head><meta charset="utf-8"><title>CampusWorks video playback check</title></head><body style="margin:0;background:#012169"><video controls muted style="width:100%;max-height:100vh" src="${new URL(`file:///${movie.replaceAll('\\','/')}`).href}"></video></body></html>`);
    await page.goto(new URL(`file:///${player.replaceAll('\\','/')}`).href);
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:15000});
    const playback=await page.locator('video').evaluate(async video=>{video.currentTime=72;await video.play();await new Promise(done=>setTimeout(done,700));const receipt={duration:video.duration,width:video.videoWidth,height:video.videoHeight,currentTime:video.currentTime,paused:video.paused,error:video.error?.message||null};video.pause();return receipt;});
    assert.ok(playback.currentTime>72.2&&!playback.paused&&!playback.error,'The encoded movie must play in Chrome or Edge with H.264/AAC support.');
    manifest.verification={fullDecode:'passed',browserPlayback:{...playback,browser:reviewBrowser.version()},audioMeanDb:meanVolume,audioPeakDb:peakVolume,sampledFrames,contactSheet:local(sheet),sourceCrop:{x:0,y:112,width:1440,height:888,reason:'Remove the redundant recorded presentation banner; the correctly timed role and step are shown in the left caption. Product pixels retain their original size.'}};
  } finally {await reviewBrowser.close();}
  manifest.boundaries.push('The top 112 pixels of each workflow source clip, containing the presentation-only stage banner, are cropped. Product UI pixels are kept at their original size; the remaining canvas is padded.');
  manifest.status='passed';
  writeFileSync(resolve(output,'video-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`PASS ${local(movie)}: ${metadata.format.duration}s, H.264/AAC, 1920×1080.`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
