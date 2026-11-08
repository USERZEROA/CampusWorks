import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep, dirname } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const captureDirectory = resolve(root, 'docs/demo/screenshots');
const imagePath = name => resolve(captureDirectory, name);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dataImage = path => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const asset = name => `showcase-${name}.png`;

export const submissionCards = [
  { id: '01-connected-lifecycle', role: 'Four roles · one connected workflow', title: 'From application to student support.', subtitle: 'TA/RA recruitment, appointments, course queues and evidence for the next cycle.', kind: 'hero', sources: [asset('applicant-applications-desktop'), asset('avery-active-application'), asset('avery-ta-queue')] },
  { id: '02-recruitment', role: 'Administrator + instructor', title: 'Publish the work that needs doing.', subtitle: 'A shared recruitment cycle brings TA and RA openings into one view.', sources: [asset('recruitment-desktop')], crop: 65 },
  { id: '03-applicant-workspace', role: 'Student', title: 'A clear place to follow every application.', subtitle: 'Candidates keep their applications, offers and notifications together.', sources: [asset('applicant-applications-desktop')], crop: 100 },
  { id: '04-candidate-review', role: 'Instructor', title: 'Evidence before a decision.', subtitle: 'Review submitted qualifications, CV records and current availability.', sources: [asset('candidate-pool-desktop')], crop: 410 },
  { id: '05-ai-requirements', role: 'Instructor · AI assistance', title: 'Make requirements easier to review.', subtitle: 'Qualification-focused wording and questions, with the instructor retaining the decision.', sources: [asset('ai-requirements-desktop')], fit: true, ai: true },
  { id: '06-ai-qualification-summary', role: 'Instructor · AI assistance', title: 'See preparation and missing evidence.', subtitle: 'An evidence-linked summary of typed qualifications and screening answers.', sources: [asset('ai-summary-desktop')], fit: true, ai: true },
  { id: '07-ai-eligible-alternatives', role: 'Second instructor · AI assistance', title: 'Availability changes. Advice updates.', subtitle: 'CS101 considers eligible alternatives after another course reserves Alex.', sources: [asset('ai-candidates-desktop')], crop: 220, ai: true, note: 'Selected section · page 1 compares ten eligible candidates, not the full pool.' },
  { id: '08-administrative-clearance', role: 'Administrator', title: 'An offer is only the beginning.', subtitle: 'Record administrative clearance before a dated TA appointment enables course access.', sources: [asset('clearance-desktop')], crop: 4020 },
  { id: '09-student-becomes-ta', role: 'Same student account → course TA', title: 'Acceptance. Clearance. The right access.', subtitle: 'Avery’s accepted and cleared CS201 appointment opens the TA queue.', sources: [asset('avery-active-application')], crop: 90 },
  { id: '10-ta-help-session', role: 'Avery · appointed CS201 TA', title: 'The same person now supports a student.', subtitle: 'Start duty and claim a waiting request through the course’s ordinary queue controls.', sources: [asset('avery-ta-queue')], crop: 110 },
  { id: '11-coordinated-office-hours', role: 'TA + student', title: 'One queue for coordinated office hours.', subtitle: 'Announcements, a labeled Zoom example, claims, pauses and handoffs stay together.', sources: [asset('ta-queue-desktop')], crop: 170 },
  { id: '12-course-evidence', role: 'Instructor', title: 'Connect staffing with recorded teaching work.', subtitle: 'Queue outcomes, feedback and reported work remain distinct evidence.', sources: [asset('course-report-desktop')], crop: 105 },
  { id: '13-ai-course-advice', role: 'Instructor · AI assistance', title: 'Plan the next cycle with context.', subtitle: 'Course suggestions cite observed demand and teaching coverage, with limits visible.', sources: [asset('ai-course-review-desktop')], fit: true, ai: true },
  { id: '14-department-insights', role: 'Department administrator', title: 'Know when students need support.', subtitle: 'Compare demand, staffing coverage and attributed feedback across the department.', sources: [asset('department-insights-desktop')], crop: 410 },
  { id: '15-mobile-application', role: 'Student · responsive experience', title: 'Keep the candidate’s next step within reach.', subtitle: 'Browse requirements and respond to an offer on a smaller screen.', kind: 'mobile', sources: [asset('position-catalog-mobile'), asset('applicant-offer-mobile')] },
];

function framedImage(name, { fit = false, crop = 0, label = 'CampusWorks · actual browser capture', className = '' } = {}) {
  return `<div class="browser ${className}"><div class="browser-bar"><span class="dots">● ● ●</span><span>${escape(label)}</span><span class="frame-mark">CAMPUSWORKS</span></div><div class="viewport ${fit ? 'fit' : ''}"><img class="capture" data-crop="${crop}" src="${dataImage(imagePath(name))}" alt="Actual CampusWorks application screenshot"></div></div>`;
}

export function renderSubmissionCard(card, index) {
  const evidence = card.ai ? 'Saved real OpenAI response · synthetic evidence' : 'Actual application capture · synthetic records';
  let visual;
  if (card.kind === 'hero') {
    visual = `<div class="hero-copy"><div class="hero-stats"><div><b>10</b><span>demo courses</span></div><div><b>21</b><span>TA / RA openings</span></div><div><b>68</b><span>applications</span></div></div><div class="journey"><span>Apply</span><i>→</i><span>Accept + clear</span><i>→</i><span>Support students</span></div></div><div class="hero-frames">${framedImage(card.sources[0], { crop: 90, label: 'Student · applications' })}${framedImage(card.sources[1], { crop: 120, label: 'Same account · active appointment' })}${framedImage(card.sources[2], { crop: 130, label: 'TA · course queue' })}</div>`;
  } else if (card.kind === 'mobile') {
    visual = `<div class="mobile-copy"><div class="eyebrow">APPLICATION → OFFER</div><h2>One account.<br>Clear next steps.</h2><p>The candidate stays in the same workflow from browsing a position to answering an offer.</p><div class="mobile-pills"><span>Requirements</span><span>Application status</span><span>Offer response</span></div></div><div class="mobile-frames">${framedImage(card.sources[0], { crop: 55, label: 'Browse positions', className: 'phone' })}${framedImage(card.sources[1], { crop: 90, label: 'Respond to an offer', className: 'phone' })}</div>`;
  } else visual = framedImage(card.sources[0], { fit: card.fit, crop: card.crop, label: card.ai ? 'OpenAI · saved actual response' : 'CampusWorks · actual browser capture' });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(card.title)}</title><style>
    *{box-sizing:border-box}html,body{margin:0;width:1800px;height:1200px;overflow:hidden}body{font-family:"Segoe UI",Arial,sans-serif;color:#10213b;background:#f3f6fc}.canvas{width:1800px;height:1200px;position:relative;background:radial-gradient(ellipse at 90% 22%,#dce8ff 0,transparent 43%),#f3f6fc}.brand{height:108px;background:#012169;color:white;display:flex;align-items:center;padding:0 72px;gap:45px;border-bottom:5px solid #00bda5}.brand img{width:265px;height:auto}.wordmark{font-weight:750;font-size:37px;letter-spacing:-1px}.brand .edition{margin-left:auto;font-size:17px;letter-spacing:2px;color:#dce9ff}.intro{position:absolute;left:72px;right:72px;top:143px}.role{font-size:18px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:#1c448d;display:flex;align-items:center;gap:15px}.role:before{content:"";width:28px;height:4px;background:#00a58f}h1{font-size:56px;line-height:1.13;letter-spacing:-1.4px;margin:15px 0 10px;max-width:1600px}.subtitle{font-size:25px;line-height:1.45;color:#51627e;margin:0}.visual{position:absolute;left:72px;right:72px;top:329px;height:771px}.browser{height:100%;border:1px solid #b9c9e4;border-radius:17px;overflow:hidden;background:white;box-shadow:0 17px 40px #142b5c1b}.browser-bar{height:41px;display:flex;align-items:center;gap:20px;background:#e7edf8;padding:0 22px;color:#445a7b;font-size:14px;border-bottom:1px solid #c5d3e9}.dots{letter-spacing:4px;color:#6a82a8;font-size:12px}.frame-mark{margin-left:auto;font-size:10px;letter-spacing:2px;color:#6a7d9a}.viewport{position:relative;height:calc(100% - 41px);overflow:hidden;background:#f8faff}.capture{position:absolute;left:0;width:100%;height:auto;display:block}.fit{display:flex;align-items:center;justify-content:center;padding:18px}.fit .capture{position:static;width:100%;height:100%;object-fit:contain}.footer{position:absolute;left:72px;right:72px;bottom:38px;display:flex;align-items:center;gap:20px;color:#536580;font-size:16px}.footer .evidence{background:#e4ecfa;border:1px solid #cbd8ef;padding:9px 15px;border-radius:30px}.footer .note{font-size:14px}.footer .index{margin-left:auto;color:#012169;font-weight:700;font-size:18px}.hero-copy{height:180px;display:flex;align-items:flex-start;justify-content:space-between;gap:40px}.hero-stats{display:flex;gap:18px}.hero-stats>div{width:180px;border-left:4px solid #1c448d;padding:12px 20px;background:white;border-radius:8px;box-shadow:0 5px 20px #1235640a}.hero-stats b{display:block;font-size:42px;color:#012169}.hero-stats span{font-size:17px;color:#526481}.journey{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-top:38px}.journey span{background:#012169;color:white;padding:16px 21px;border-radius:10px;font-size:21px;font-weight:650}.journey i{color:#318479;font-style:normal;font-size:30px}.hero-frames{height:591px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.hero-frames .browser{border-radius:12px}.hero-frames .browser-bar{padding:0 13px;font-size:13px;gap:10px}.hero-frames .frame-mark{display:none}.hero-frames .capture{width:140%;left:0}.mobile-copy{position:absolute;width:510px;left:15px;top:65px}.eyebrow{font-size:17px;font-weight:700;letter-spacing:2px;color:#41608f}.mobile-copy h2{font-size:52px;line-height:1.15;letter-spacing:-1px;margin:24px 0}.mobile-copy p{color:#536580;font-size:25px;line-height:1.5}.mobile-pills{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}.mobile-pills span{border:1px solid #bccce5;background:#fff;padding:12px 18px;border-radius:30px;color:#21467f;font-size:19px}.mobile-frames{position:absolute;right:12px;top:0;height:771px;display:flex;gap:35px}.phone{width:475px;border:9px solid #15315d;border-radius:27px;box-shadow:0 15px 30px #01216924}.phone .browser-bar{height:35px;padding:0 12px;justify-content:center;font-size:13px}.phone .dots,.phone .frame-mark{display:none}.phone .viewport{height:calc(100% - 35px)}
  </style></head><body><div class="canvas"><header class="brand"><img src="${dataImage(resolve(root,'public/duke-cs-logo.png'))}" alt="Duke Computer Science"><span class="wordmark">CampusWorks</span><span class="edition">PRODUCT WALKTHROUGH</span></header><section class="intro"><div class="role">${escape(card.role)}</div><h1>${escape(card.title)}</h1><p class="subtitle">${escape(card.subtitle)}</p></section><main class="visual">${visual}</main><footer class="footer"><span class="evidence">${evidence}</span><span class="note">${escape(card.note || 'Selected view · original screenshots retained')}</span><span class="index">${String(index + 1).padStart(2,'0')} / 15</span></footer></div><script>
    Promise.all([...document.images].map(image=>image.decode())).then(()=>{for(const image of document.querySelectorAll('.capture[data-crop]')){if(image.closest('.fit'))continue;const scale=image.getBoundingClientRect().width/image.naturalWidth;image.style.top=-(Number(image.dataset.crop)*scale)+'px'}window.ready=true});
  </script></body></html>`;
}

async function main() {
  const flags = process.argv.slice(2);
  let output = resolve(root,'.cache/submission-export/images');
  if (flags.length) {
    if (flags.length !== 2 || flags[0] !== '--output') throw new Error('Use --output with a repository-local directory.');
    output = resolve(root,flags[1]);
  }
  if (!output.startsWith(root + sep)) throw new Error('Export images to a subdirectory within the repository workspace.');
  mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const manifest = { recordedAt:new Date().toISOString(), width:1800,height:1200,aspectRatio:'3:2',sourcePolicy:'Actual original screenshots arranged in HTML/CSS; crops show selected sections and original PNG bytes remain unchanged. No model call or invented application UI.', images:[] };
  try {
    const page = await browser.newPage({viewport:{width:1800,height:1200},deviceScaleFactor:1});
    const runtimeErrors=[]; page.on('pageerror',error=>runtimeErrors.push(error.message));
    for (const [index,card] of submissionCards.entries()) {
      const source = card.sources.map(name=>({path:relative(root,imagePath(name)).split(sep).join('/'),sha256:digest(readFileSync(imagePath(name)))}));
      await page.evaluate(()=>{window.ready=false;});
      await page.setContent(renderSubmissionCard(card,index),{waitUntil:'load'});
      await page.waitForFunction(()=>window.ready===true);
      if (runtimeErrors.length) throw new Error(runtimeErrors.join('; '));
      const path=resolve(output,`${card.id}.png`);
      await page.screenshot({path});
      const bytes=readFileSync(path);
      if(bytes.readUInt32BE(16)!==1800||bytes.readUInt32BE(20)!==1200||bytes.length>=5000000)throw new Error(`Image dimensions/size failed: ${card.id}`);
      manifest.images.push({id:card.id,title:card.title,role:card.role,path:relative(root,path).split(sep).join('/'),bytes:bytes.length,sha256:digest(bytes),source,savedRealAI:!!card.ai});
      console.log(`${index+1}/15 ${card.id}: ${Math.round(bytes.length/1024)} KB`);
    }
    await page.setViewportSize({width:1800,height:2000});
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CampusWorks upload image selection</title><style>*{box-sizing:border-box}html,body{margin:0;background:#dbe4f3;width:1800px;height:2000px}.grid{display:grid;grid-template-columns:repeat(3,600px);grid-auto-rows:400px}.grid img{width:600px;height:400px;object-fit:contain;border:3px solid #dbe4f3}</style></head><body><div class="grid">${manifest.images.map(item=>`<img src="${dataImage(resolve(root,item.path))}" alt="${escape(item.title)}">`).join('')}</div></body></html>`);
    await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    await page.screenshot({path:resolve(dirname(output),'contact-sheet.png')});
    writeFileSync(resolve(dirname(output),'images-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  } finally { await browser.close(); }
  console.log(`Exported ${manifest.images.length} upload images and a contact sheet to ${relative(root,output)}.`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
