import { createInitialState, loadState, saveState, currentActor, command, getRoleViews, getCourseRole, getInsights, STORAGE_KEY } from './model.mjs';
import { AI_EXAMPLES } from './ai-examples.mjs';

const root = document.querySelector('#app');
let state;
try { state = loadState() || createInitialState(); } catch { state = createInitialState(); }
let hasStoredWorkspace=false;
try{hasStoredWorkspace=!!localStorage.getItem(STORAGE_KEY);}catch{}
let selectedRole = 'student';
let notice = '';
let noticeKind = 'success';
let switchOpen = false;
let search = '';
let typeFilter = 'all';
let feedbackSession = '';
const roleNames = { student: 'Student', ta: 'TA', instructor: 'Instructor', admin: 'Administrator' };
const defaults = { student: 'student-two', ta: 'ta-labs', instructor: 'faculty-algorithms', admin: 'admin' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const date = value => value ? new Date(value).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '—';
const human = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
const actor = () => currentActor(state);
const person = id => state.actors.find(item => item.id === id);
const courseBy = id => state.courses.find(item => item.id === id);
const positionBy = id => state.opportunities.find(item => item.id === id);
const appBy = id => state.applications.find(item => item.id === id);
const appointmentFor = id => state.appointments.find(item => item.applicationId === id);
const href = route => `#/${route}`;
const link = (route, label, kind='') => `<a class="button ${kind}" href="${href(route)}">${esc(label)}</a>`;
const button = (action, label, data={}, kind='', disabled=false) => `<button type="button" class="${kind}" data-action="${action}" ${Object.entries(data).map(([key,value]) => `data-${key}="${esc(value)}"`).join(' ')} ${disabled?'disabled':''}>${esc(label)}</button>`;
const badge = value => {
  const green = ['active','cleared','open','published','helping','TA'];
  const amber = ['offered','pending_clearance','pending_start','needs_information','paused','pending_approval','shortlisted'];
  const red = ['closed','ended','not_cleared','not_selected','withdrawn','restricted'];
  return `<span class="status ${green.includes(value)?'green':amber.includes(value)?'amber':red.includes(value)?'red':'blue'}">${esc(human(value))}</span>`;
};
const panel = (title, body, extra='') => `<section class="panel"><h2>${esc(title)}</h2>${extra}<div class="panel-body">${body}</div></section>`;
const table = (headings, rows, empty='No records yet.') => `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(headings.join(', '))} table"><table><thead><tr>${headings.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headings.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const field = (name,label,value='',options={}) => `<div class="${options.wide?'wide':''}"><label for="field-${name}">${esc(label)}</label>${options.textarea?`<textarea id="field-${name}" name="${name}" ${options.required?'required':''} ${options.readonly?'readonly':''}>${esc(value)}</textarea>`:`<input id="field-${name}" name="${name}" value="${esc(value)}" type="${options.type||'text'}" ${options.required?'required':''} ${options.readonly?'readonly':''} ${options.min!==undefined?`min="${options.step&&options.type==='number'?0.01:options.min}"`:''} ${options.max!==undefined?`max="${options.max}"`:''} ${options.step?`step="${options.type==='number'?'any':esc(options.step)}"`:''}>`}</div>`;
function effectiveRole(course) {
  try { const role=getCourseRole(state, course.id, actor()?.id); return role==='none'?null:role; } catch { return null; }
}
function persist(next) {
  const saved=saveState(next);
  if(saved===false){
    let stored,readable=false;
    try{stored=localStorage.getItem(STORAGE_KEY);readable=true;}catch{}
    if(readable&&(stored||hasStoredWorkspace)){
      const latest=loadState();
      if(!stored||latest.workspaceId!==state.workspaceId||latest.revision>state.revision){state=latest;hasStoredWorkspace=!!stored;throw new Error('This workspace changed in another tab. Please try the action again.');}
    }
  }
  state=next;
  if(saved!==false)hasStoredWorkspace=true;
  return saved!==false;
}
function act(type, data={}, message='Saved.') {
  try { const saved=persist(command(state,{type,...data})); notice=message+(saved?'':' Changes are kept in this tab only because browser storage is unavailable.'); noticeKind='success'; return true; }
  catch(error) { notice=error.message || 'This action is unavailable.'; noticeKind='error'; return false; }
}
function go(route) { if(location.hash === href(route)) render(); else location.hash = href(route); }
function route() { return location.hash.replace(/^#\/?/,'').split('/').filter(Boolean); }
function savedAi(kind, title) {
  if(!getRoleViews(state).canHire)return '';
  const example = AI_EXAMPLES.find(item => item.kind === kind);
  if (!example) return '';
  const items = example.items || [];
  return panel(title || example.title, `<div class="ai-label">Saved real OpenAI result</div><p class="small-copy">Recorded synthetic example from the full application. Browser actions do not call AI.</p><div class="ai-result"><p>${esc(example.summary)}</p>${items.slice(0,3).map(item=>`<div class="candidate"><h3>${esc(item.name || 'Evidence')}</h3><p>${esc(item.explanation)}</p></div>`).join('')}${items.length>3?`<details><summary>View ${items.length-3} more observations</summary>${items.slice(3).map(item=>`<div class="candidate"><h3>${esc(item.name || 'Evidence')}</h3><p>${esc(item.explanation)}</p></div>`).join('')}</details>`:''}${example.cautions?.length?`<p class="small-copy">${esc(example.cautions.join(' '))}</p>`:''}<p class="evidence">OpenAI · ${esc(example.provider?.model || 'Recorded model')} · Saved example</p></div>`);
}
function header() {
  const user = actor();
  return `<div class="browser-note"><span><strong>Browser demo</strong> · Synthetic data stays on this device.</span>${button('reset','Reset workspace',{},'quiet')}</div><header class="masthead"><a href="#/courses" aria-label="CampusWorks home"><img class="logo" src="../../public/duke-cs-logo.png" alt="Duke Department of Computer Science" width="381" height="70"></a><a class="brand" href="#/courses">CampusWorks</a>${user?`<div class="identity"><span class="account-name">${esc(user.name)}</span><span class="role-badge">${esc(roleNames[user.role])}</span>${button('switch','Switch role')}${button('logout','Log out')}</div>`:'<span></span>'}</header>`;
}
function footer() { return `<footer><span>CampusWorks · From application to student support</span><span>Independent browser workspace · No real hiring or document upload</span><a href="../demo/">Project gallery</a></footer>`; }
function login() {
  const people = state.actors.filter(item=>item.role===selectedRole);
  const descriptions = {student:'Apply, accept and receive help.',ta:'Run office hours and report work.',instructor:'Publish, review and make offers.',admin:'Coordinate clearance and the department.'};
  const symbols = {student:'S',ta:'TA',instructor:'I',admin:'A'};
  root.innerHTML=header()+`<main id="main" class="login-shell"><div class="login-intro"><p class="eyebrow">Interactive product demo</p><h1>One journey.<br>Four connected roles.</h1><p>Try recruitment, appointment and course support in your own workspace.</p></div><div class="login-roles" aria-label="Choose a role">${Object.keys(roleNames).map(role=>`<button type="button" class="role-card" data-action="choose-role" data-role="${role}" aria-pressed="${role===selectedRole}"><span class="role-symbol" aria-hidden="true">${symbols[role]}</span><strong>${roleNames[role]}</strong><span>${descriptions[role]}</span></button>`).join('')}</div><form class="login-form" data-form="login"><div><label for="persona">Demo identity</label><select id="persona" name="actorId">${people.map(item=>`<option value="${esc(item.id)}" ${item.id===defaults[selectedRole]?'selected':''}>${esc(item.name)} · ${esc(item.email)}</option>`).join('')}</select></div><button type="submit">Enter as ${roleNames[selectedRole]}</button><p class="small-copy">Switch roles at any time. Avery has a prepared offer; Casey can start a new application.</p></form><p class="login-facts">10 courses · 21 TA/RA positions · Applications, queues, feedback and insights</p></main>`+footer();
}
function navigation() {
  const views=getRoleViews(state), current=route()[0] || 'courses';
  const links=[['courses','Courses'],['opportunities','Opportunities'],['applications','My Applications']];
  if(views.canHire) links.push(['staffing','Staffing']);
  if(views.isAdmin) links.push(['administration','Administration']);
  if(views.canHire) links.push(['insights','Course Insights']);
  return `<nav class="navigation" aria-label="Main navigation">${links.map(([path,label])=>`<a href="${href(path)}" ${current===path?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
}
function switcher() {
  if(!switchOpen) return '';
  return `<form class="switch-menu" data-form="switch"><label for="switch-persona">Switch demo identity</label><select id="switch-persona" name="actorId">${Object.keys(roleNames).map(role=>`<optgroup label="${roleNames[role]}">${state.actors.filter(item=>item.role===role).map(item=>`<option value="${esc(item.id)}" ${item.id===actor().id?'selected':''}>${esc(item.name)}</option>`).join('')}</optgroup>`).join('')}</select><div class="actions"><button type="submit">Switch identity</button>${button('switch','Cancel',{},'secondary')}</div></form>`;
}
function heading(title,description='',action='') {return `<div class="page-heading"><div><h1>${esc(title)}</h1>${description?`<p class="muted">${esc(description)}</p>`:''}</div>${action?`<div class="actions">${action}</div>`:''}</div>`;}
function home() {
  const user=actor(), views=getRoleViews(state);
  const ownApps=state.applications.filter(item=>item.applicantId===user.id);
  const offered=ownApps.find(item=>appointmentFor(item.id)?.status==='offered');
  const active=state.appointments.find(item=>item.applicantId===user.id && item.status==='active' && item.type==='ta');
  const target=views.isAdmin?'administration':views.canHire?'staffing':active?`queue/${active.courseId}`:offered?`applications/${offered.id}`:'opportunities';
  const targetLabel=views.isAdmin?'Review clearance':views.canHire?'Review candidates':active?'Open your TA queue':offered?'Open your offer':'Find a position';
  const rows=state.courses.map(course=>{
    const role=effectiveRole(course);
    return `<tr><td><strong>${esc(course.code)}</strong><span class="muted">${esc(course.title)}</span></td><td>${role?badge(role==='ta'?'TA':role):'<span class="muted">Not enrolled</span>'}</td><td>${badge(course.queueState)}</td><td class="actions-cell"><div class="actions">${link(`queue/${course.id}`,'Go','small')}${!role?button('enroll','Enroll',{course:course.id},'small secondary'):role==='student'?button('leave-course','Leave',{course:course.id},'small secondary'):''}</div></td></tr>`;
  });
  const mine=state.courses.filter(course=>effectiveRole(course));
  return heading('My Courses',`Welcome, ${user.name.split(' ')[0]}.`)+`<section class="journey"><div><h2>From application to student support.</h2><p>${offered?'Your prepared offer is ready. Acceptance and clearance unlock the course TA workspace.':active?'Your active appointment now enables course support. Try helping a student, then review the outcomes.':'Follow a candidate from recruitment into the course, then inspect the evidence for the next cycle.'}</p><div class="steps"><span>Apply</span>→<span>Offer</span>→<span>Clearance</span>→<span>TA queue</span>→<span>Insights</span></div></div><div class="actions">${link(target,targetLabel)}</div></section><div class="metric-row"><div class="metric"><span>Your courses</span><strong>${mine.length}</strong></div><div class="metric"><span>Open positions</span><strong>${state.opportunities.filter(item=>item.status==='published').length}</strong></div><div class="metric"><span>Your applications</span><strong>${ownApps.length}</strong></div><div class="metric"><span>Recruitment</span><strong style="font-size:1.35rem;padding-top:9px">${state.cycle.enabled?'Open':'Closed'}</strong><small>${esc(state.term.name)}</small></div></div>`+panel('All Available Courses',table(['Course','Your role','Queue','Action'],rows));
}
function opportunities() {
  const list=state.opportunities.filter(item=>['published','applications_closed','filled'].includes(item.status)).filter(item=>(typeFilter==='all'||item.type===typeFilter)&&`${item.title} ${courseBy(item.courseId)?.code||''}`.toLowerCase().includes(search.toLowerCase()));
  return heading('Opportunities','TA and RA positions for the current recruitment cycle.')+`<div class="filters"><div><label for="position-search">Search positions</label><input id="position-search" data-filter="search" value="${esc(search)}" type="search"></div><div><label for="position-type">Appointment type</label><select id="position-type" data-filter="type"><option value="all">All types</option><option value="ta" ${typeFilter==='ta'?'selected':''}>TA</option><option value="ra" ${typeFilter==='ra'?'selected':''}>RA</option></select></div></div><div class="grid three">${list.map(item=>`<article class="position-card"><div class="row-summary"><span class="role-badge">${esc(item.type.toUpperCase())}</span>${badge(item.status)}</div><h3>${esc(item.title)}</h3><p class="muted">${esc(courseBy(item.courseId)?.code || 'Faculty appointment')} · ${esc(person(item.ownerId)?.name)}</p><div class="pill-list"><span class="pill">${item.weeklyHours} h / week</span><span class="pill">${item.positions} position${item.positions===1?'':'s'}</span></div><div class="actions">${link(`opportunities/${item.id}`,'View requirements','secondary small')}</div></article>`).join('')||'<p class="empty">No matching positions.</p>'}</div>`;
}
function positionDetail(id) {
  const item=positionBy(id); if(!item)return missing();
  const own=state.applications.find(app=>app.opportunityId===id&&app.applicantId===actor().id);
  const duties=[item.attendanceRequired&&'Attendance',item.labRequired&&'Lab',item.discussionRequired&&'Discussion',item.gradingRequired&&'Grading',item.officeHoursRequired&&'Office hours'].filter(Boolean);
  return `<a class="breadcrumb" href="#/opportunities">← Opportunities</a>`+heading(item.title,`${item.type.toUpperCase()} · ${courseBy(item.courseId)?.code || 'Faculty appointment'} · ${person(item.ownerId)?.name || ''}`)+`<div class="split"><div>${panel('Position requirements',`<div class="pill-list">${badge(item.status)}<span class="pill">${item.weeklyHours} h / week</span><span class="pill">${item.positions} positions</span></div><p class="preserve">${esc(item.description)}</p><dl class="detail-list"><dt>Skills</dt><dd>${esc(item.requiredSkills || 'See screening questions')}</dd><dt>Appointment</dt><dd>${date(item.appointmentStart)} – ${date(item.appointmentEnd)}</dd><dt>Responsibilities</dt><dd>${esc(duties.join(' · ')||'Listed in the description')}</dd></dl><div class="divider"></div><h3>Qualification questions</h3><ol>${(item.questions||[]).map(q=>`<li>${esc(q.prompt)}</li>`).join('')}</ol><div class="actions">${own?link(`applications/${own.id}`,'Open your application'):getRoleViews(state).canApply?button('start-application','Start application',{position:id}):''}${getRoleViews(state).managedOpportunities.some(p=>p.id===id)?link(`staffing/${id}`,'Manage position','secondary'):''}</div>`)}</div><aside>${savedAi('opportunity_draft','AI requirement example')}</aside></div>`;
}
function applications() {
  const list=state.applications.filter(item=>item.applicantId===actor().id);
  return heading('My Applications','Your answers, offers and appointments.')+panel('Application history',table(['Position','Status','Appointment','Action'],list.map(item=>{const posting=positionBy(item.opportunityId),appointment=appointmentFor(item.id);return `<tr><td><strong>${esc(posting?.title||'Position')}</strong><span class="muted">${esc(courseBy(posting?.courseId)?.code||posting?.type?.toUpperCase())}</span></td><td>${badge(item.status)}</td><td>${appointment?badge(appointment.status):'—'}</td><td class="actions-cell">${link(`applications/${item.id}`,'Open application','small secondary')}</td></tr>`;})));
}
function applicationDetail(id) {
  const application=appBy(id);if(!application)return missing();
  const position=positionBy(application.opportunityId), student=person(application.applicantId), appointment=appointmentFor(id);
  const own=application.applicantId===actor().id, manager=getRoleViews(state).managedOpportunities.some(item=>item.id===position.id);
  if(!own&&!manager)return missing();
  const profile=application.profile||{};
  const editable=own&&['draft','withdrawn'].includes(application.status);
  let appointmentBody='';
  if(appointment){
    let controls='';
    if(own&&appointment.status==='offered')controls=button('accept-offer','Accept offer',{appointment:appointment.id})+button('decline-offer','Decline',{appointment:appointment.id},'secondary');
    if(appointment.status==='active'&&own&&appointment.type==='ta')controls+=link(`queue/${appointment.courseId}`,'Open TA Queue');
    appointmentBody=panel('Your appointment',`<div class="row-summary">${badge(appointment.status)}<span class="muted">${date(appointment.startDate)} – ${date(appointment.endDate)}</span></div><p>${appointment.status==='pending_clearance'?'Your offer is accepted. Switch to Administrator to record clearance.':appointment.status==='active'?'Acceptance, clearance and dates are complete.':appointment.status==='offered'?'Accepting the offer starts the clearance step.':'The appointment history remains available.'}</p><div class="actions">${controls}</div>`);
  }
  return `<a class="breadcrumb" href="${href(own?'applications':`staffing/${position.id}`)}">← ${own?'My Applications':'Candidates'}</a>`+heading(position.title,student.name)+appointmentBody+`<div class="split"><div>${panel('Application',`<div class="row-summary">${badge(application.status)}<span class="muted">${esc(position.type.toUpperCase())} · ${esc(courseBy(position.courseId)?.code || 'Faculty appointment')}</span></div>${editable?`<form data-form="application" data-id="${esc(id)}" data-position="${esc(position.id)}"><div class="form-grid">${field('firstName','First name',profile.firstName||student.name.split(' ')[0],{required:true})}${field('lastName','Last name',profile.lastName||student.name.split(' ').slice(1).join(' '),{required:true})}${field('preferredEmail','Preferred email',profile.preferredEmail||student.email,{required:true,type:'email'})}${field('undergraduateMajors','Undergraduate major(s)',profile.undergraduateMajors||'Computer Science',{required:true})}${field('availableHours','Available hours per week',profile.availableHours||10,{required:true,type:'number',min:1,max:20,step:.5})}${field('availability','Weekly availability',profile.availability||'Weekday afternoons',{required:true})}${field('skills','Relevant skills',profile.skills||'',{wide:true,required:true})}${(position.questions||[]).map(q=>field(`answer:${q.id}`,q.prompt,application.answers?.[q.id]||'',{textarea:true,wide:true,required:q.required})).join('')}${field('qualificationText','Relevant experience',application.qualificationText||'',{textarea:true,wide:true})}<div class="wide"><label for="demo-cv">CV</label><input id="demo-cv" type="file" accept=".pdf,.txt" data-file="cv"><input type="hidden" name="cvName" value="${esc(application.cv?.name||'')}"><p class="file-line"><span data-cv-label>${esc(application.cv?.name||'No CV selected')}</span>${button('sample-cv','Use demo CV',{},'small secondary')}</p><p class="small-copy">This browser demo keeps the filename only.</p></div></div><div class="actions" style="margin-top:21px">${button('save-application','Save draft',{},'secondary')}<button type="submit">Submit application</button></div></form>`:`<dl class="detail-list"><dt>Name</dt><dd>${esc(student.name)}</dd><dt>Major</dt><dd>${esc(profile.undergraduateMajors||'Computer Science')}</dd><dt>Available hours</dt><dd>${esc(profile.availableHours||'—')}</dd><dt>Availability</dt><dd>${esc(profile.availability||'See application')}</dd><dt>Skills</dt><dd>${esc(profile.skills||application.qualificationText||'See answers')}</dd><dt>CV</dt><dd>${esc(application.cv?.name||'No CV metadata')}</dd></dl><div class="divider"></div>${(position.questions||[]).map(q=>`<h3>${esc(q.prompt)}</h3><p class="preserve">${esc(application.answers?.[q.id]||'No answer recorded.')}</p>`).join('')}<h3>Experience</h3><p class="preserve">${esc(application.qualificationText||'See submitted profile.')}</p>${own&&!appointment&&!['withdrawn','not_selected'].includes(application.status)?`<div class="actions">${button('withdraw','Withdraw application',{application:id},'danger')}</div>`:''}`}`)}</div><aside>${savedAi('cv_summary','AI qualification example')}</aside></div>`;
}
function staffing(id) {
  const views=getRoleViews(state);if(!views.canHire)return missing();
  if(id)return staffingDetail(id);
  return heading('Staffing','Publish responsibilities and review applications.',button('new-position','New position'))+panel('Your positions',table(['Position','Status','Applicants','Capacity','Action'],views.managedOpportunities.map(item=>`<tr><td><strong>${esc(item.title)}</strong><span class="muted">${esc(courseBy(item.courseId)?.code||'Faculty appointment')} · ${item.type.toUpperCase()}</span></td><td>${badge(item.status)}</td><td>${state.applications.filter(app=>app.opportunityId===item.id).length}</td><td>${state.appointments.filter(ap=>ap.opportunityId===item.id&&!['ended','declined','not_cleared','cancelled'].includes(ap.status)).length} / ${item.positions}</td><td class="actions-cell">${link(`staffing/${item.id}`,'Manage','small secondary')}</td></tr>`)));
}
function staffingDetail(id) {
  const posting=positionBy(id),views=getRoleViews(state);if(!posting||!views.managedOpportunities.some(item=>item.id===id))return missing();
  const candidates=state.applications.filter(item=>item.opportunityId===id&&item.status!=='draft');
  const appointments=state.appointments.filter(item=>item.opportunityId===id);
  const allocated=appointments.filter(item=>!['ended','declined','not_cleared','cancelled'].includes(item.status)).length;
  const controls=posting.status==='draft'?button('publish-position','Publish for approval',{position:id}):posting.status==='published'?button('close-position','Close applications',{position:id},'secondary'):['applications_closed','filled'].includes(posting.status)?button('archive-position','Archive opening',{position:id},'secondary'):'';
  return `<a class="breadcrumb" href="#/staffing">← Staffing</a>`+heading(posting.title,`${courseBy(posting.courseId)?.code||'Faculty appointment'} · ${posting.type.toUpperCase()}`,controls)+`<div class="metric-row"><div class="metric"><span>Applications</span><strong>${candidates.length}</strong></div><div class="metric"><span>Reserved positions</span><strong>${allocated} / ${posting.positions}</strong></div><div class="metric"><span>Weekly hours</span><strong>${posting.weeklyHours}</strong></div><div class="metric"><span>Status</span><strong style="font-size:1.1rem;padding-top:12px">${esc(human(posting.status))}</strong></div></div><div class="split"><div>${panel('Candidates',table(['Applicant','Evidence','Status','Actions'],candidates.map(application=>{
    const appointment=appointmentFor(application.id),unavailable=state.appointments.some(item=>item.applicantId===application.applicantId&&item.opportunityId!==id&&!['ended','declined','not_cleared','cancelled'].includes(item.status));
    const canSelect=!appointment&&!unavailable&&allocated<posting.positions&&!['withdrawn','not_selected'].includes(application.status);
    return `<tr><td><strong>${esc(person(application.applicantId)?.name)}</strong><span class="muted">${esc(application.profile?.undergraduateMajors||'Computer Science')}</span></td><td>${esc(application.profile?.skills||'Qualification answers and CV')}<span class="muted">${esc(application.cv?.name||'No CV metadata')}</span></td><td>${badge(appointment?.status||application.status)}${unavailable?'<span class="muted">Reserved for another appointment</span>':''}</td><td class="actions-cell"><div class="actions">${link(`applications/${application.id}`,'Review','small secondary')}${!appointment?button('shortlist','Shortlist',{application:application.id},'small secondary',unavailable||application.status==='withdrawn'):''}${!appointment?button('select','Select',{application:application.id},'small',!canSelect):''}</div></td></tr>`;
  })))}${panel('Appointments',table(['Person','Status','Action'],appointments.map(appointment=>`<tr><td>${esc(person(appointment.applicantId)?.name)}</td><td>${badge(appointment.status)}</td><td class="actions-cell"><div class="actions">${['active','suspended','pending_start','pending_clearance'].includes(appointment.status)?button('end-appointment','End appointment',{appointment:appointment.id},'small danger'):''}${appointment.status==='active'?button('suspend-appointment','Suspend',{appointment:appointment.id},'small secondary'):appointment.status==='suspended'?button('resume-appointment','Resume',{appointment:appointment.id},'small secondary'):''}</div></td></tr>`)))}</div><aside>${savedAi('candidate_fit','AI candidate example')}</aside></div>`;
}
function newPosition() {
  if(!getRoleViews(state).canHire)return missing();
  const courses=state.courses.filter(item=>actor().role==='admin'||item.instructorId===actor().id);
  return heading('New position')+panel('Responsibilities',`<form data-form="position"><div class="form-grid">${field('title','Position title','',{required:true})}<div><label for="position-kind">Type</label><select name="type" id="position-kind"><option value="ta">TA</option><option value="ra">RA</option></select></div><div><label for="position-course">Course</label><select name="courseId" id="position-course">${courses.map(item=>`<option value="${item.id}">${esc(item.code)} · ${esc(item.title)}</option>`).join('')}</select></div>${field('positions','Positions',1,{required:true,type:'number',min:1,max:20})}${field('weeklyHours','Weekly hours',10,{required:true,type:'number',min:.5,max:20,step:.5})}${field('requiredSkills','Required skills','',{required:true})}${field('description','Responsibilities','',{textarea:true,wide:true,required:true})}<div class="wide inline-checks">${[['attendanceRequired','Attendance'],['labRequired','Lab'],['discussionRequired','Discussion'],['gradingRequired','Grading'],['officeHoursRequired','Office hours']].map(([name,label])=>`<label><input type="checkbox" name="${name}" checked>${label}</label>`).join('')}</div>${field('question','Qualification question','How would you help a student reason through a difficult problem?',{textarea:true,wide:true,required:true})}</div><div class="actions" style="margin-top:20px"><button type="submit">Save position</button>${link('staffing','Cancel','secondary')}</div></form>`);
}
function administration() {
  if(actor().role!=='admin')return missing();
  const pending=state.opportunities.filter(item=>item.status==='pending_approval');
  const appointments=state.appointments.filter(item=>['pending_clearance','pending_start'].includes(item.status));
  return heading('Administration','Recruitment, approval and appointment clearance.')+panel('Recruitment cycle',`<div class="row-summary"><div><strong>${esc(state.term.name)}</strong><p class="muted">${date(state.cycle.opensAt)} – ${date(state.cycle.closesAt)}</p></div><div class="actions">${badge(state.cycle.enabled?'open':'closed')}${button('toggle-cycle',state.cycle.enabled?'Close recruitment':'Open recruitment',{},'secondary')}</div></div>`)+panel('Publication approvals',table(['Position','Instructor','Action'],pending.map(item=>`<tr><td><strong>${esc(item.title)}</strong><span class="muted">${item.type.toUpperCase()} · ${courseBy(item.courseId)?.code||'Faculty appointment'}</span></td><td>${esc(person(item.ownerId)?.name)}</td><td class="actions-cell">${button('approve-position','Approve',{position:item.id},'small')}</td></tr>`)),'<div class="section-note">Published positions become visible to applicants.</div>')+panel('Appointment clearance',table(['Applicant','Position','Status','Action'],appointments.map(item=>`<tr><td><strong>${esc(person(item.applicantId)?.name)}</strong></td><td>${esc(positionBy(item.opportunityId)?.title)}</td><td>${badge(item.status)}</td><td class="actions-cell"><div class="actions">${button('clear-appointment','Record cleared',{appointment:item.id},'small')}${button('needs-information','Needs information',{appointment:item.id},'small secondary')}</div></td></tr>`)),'<div class="section-note">Acceptance and clearance are required before dated TA course access.</div>');
}
function queueActions(item,index,entries,course,canQueue,role,user) {
  if(item.studentId===user.id)return button('leave-queue','Leave',{course:course.id},'small danger');
  if(!canQueue)return '';
  const manager=['admin','instructor'].includes(role),owns=item.helperId===user.id;
  const controls=[];
  if(item.status==='waiting')controls.push(button('queue-claim','Select',{entry:item.id},'small'));
  if(item.status==='helping'&&(owns||manager)){
    controls.push(button('queue-complete','Complete',{entry:item.id},'small'));
    const helper=course.onDutyIds.find(id=>id!==item.helperId&&id!==item.studentId&&!entries.some(entry=>entry.status==='helping'&&entry.helperId===id));
    if(helper)controls.push(button('queue-handoff','Other TA',{entry:item.id,helper},'small secondary'));
  }
  if(item.status==='paused')controls.push(button('queue-resume','Resume',{entry:item.id},'small secondary'));
  else if(!item.helperId||owns||manager)controls.push(button('queue-pause-entry','Pause',{entry:item.id},'small secondary'));
  if(!item.helperId||owns||manager)controls.push(button('queue-remove','Remove',{entry:item.id},'small danger'));
  controls.push(button('queue-up','↑',{entry:item.id},'small secondary',index===0),button('queue-down','↓',{entry:item.id},'small secondary',index===entries.length-1));
  return controls.join('');
}
function queuePage(id) {
  const course=courseBy(id);if(!course)return missing();
  const user=actor(),role=effectiveRole(course),staff=['ta','instructor','admin','TA'].includes(role),onDuty=course.onDutyIds.includes(user.id);
  const entries=state.queueEntries.filter(item=>item.courseId===id);
  const own=entries.find(item=>item.studentId===user.id);
  const canQueue=staff&&(onDuty||['instructor','admin'].includes(role));
  const activeAppointment=state.appointments.find(item=>item.applicantId===user.id&&item.courseId===id&&item.status==='active'&&item.type==='ta');
  const session=state.helpSessions.filter(item=>item.studentId===user.id&&item.courseId===id&&item.wasHelped).find(item=>!state.feedback.some(f=>f.sessionId===item.id));
  const controls=`<div class="stack">${button('duty',onDuty?'End duty':'Start duty',{course:id,on:String(!onDuty)})}${button('queue-open','Open queue',{course:id},'secondary',!canQueue)}${button('queue-pause','Pause queue',{course:id},'secondary',!canQueue)}${button('queue-close','Close queue',{course:id},'danger',!canQueue)}</div>`;
  const left=panel('TA on Duty',course.onDutyIds.map(id=>`<strong class="two-line">${esc(person(id)?.name)}</strong>`).join('')||'<p class="muted">No TA is on duty.</p>')+panel(staff?'Queue Controls':'Your course',staff?controls:role==='student'?`<p>You are enrolled.</p>${own?button('leave-queue','Leave queue',{course:id},'danger'):''}`:`<p>Enroll to join office hours.</p>${button('enroll','Enroll',{course:id})}`);
  const announcementBody=course.announcements.map(item=>`<div class="announcement"><p>${esc(item.message).replace(/https:\/\/zoom\.example\.com\/j\/[a-zA-Z0-9._-]+/g, url=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}</p><span class="small-copy">${esc(person(item.authorId)?.name||'Course staff')} · ${date(item.createdAt)}</span></div>`).join('');
  const announcements=panel('Announcements',announcementBody+(staff?`<form data-form="announcement" data-course="${id}" class="actions" style="margin-top:15px"><label class="sr-only" for="announcement">New announcement</label><input id="announcement" name="message" placeholder="Post an announcement…" required style="flex:1;min-width:170px"><button type="submit">Post</button></form>`:''));
  const queue=panel('Live Queue',table(['#','Student','Location','Question','TA','Actions'],entries.map((item,index)=>`<tr><td>${index+1}</td><td class="queue-name">${esc(person(item.studentId)?.name)}</td><td>${esc(item.location)}</td><td>${esc(item.question)}${item.status==='paused'?`<div>${badge('paused')}</div>`:''}</td><td class="queue-name">${esc(person(item.helperId)?.name||'—')}</td><td class="actions-cell queue-commands"><div class="actions">${queueActions(item,index,entries,course,canQueue,role,user)}</div></td></tr>`),'No students are waiting.'));
  const join=!staff&&role==='student'&&!own?panel('Ask for help',`<form data-form="join-queue" data-course="${id}"><div class="form-grid">${field('location','Location','Online · Zoom (demo)',{required:true})}${field('question','Your question','',{required:true})}</div><div class="actions" style="margin-top:15px"><button type="submit" ${course.queueState!=='open'?'disabled':''}>Join queue</button></div></form>`):'';
  const feedback=session?panel('How was your help session?',`<form data-form="feedback" data-session="${session.id}"><div class="form-grid"><div><label for="rating">Rating</label><select id="rating" name="rating">${[5,4,3,2,1].map(n=>`<option>${n}</option>`).join('')}</select></div>${field('positive','What worked well?','',{required:true})}${field('negative','What could improve?','',{wide:true})}</div><div class="actions" style="margin-top:15px"><button type="submit">Submit feedback</button></div></form>`):'';
  const work=staff?panel('Record non-queue work',`<form data-form="work" data-course="${id}" data-appointment="${activeAppointment?.id||''}"><div class="form-grid"><div><label for="work-kind">Work category</label><select id="work-kind" name="kind"><option value="grading">Grading</option><option value="lab">Lab</option><option value="preparation">Preparation</option><option value="office_hours">Office hours</option></select></div>${field('hours','Hours',1,{type:'number',min:.1,max:20,step:.1,required:true})}${field('notes','Notes','',{wide:true})}</div><div class="actions" style="margin-top:15px"><button type="submit">Record work</button></div></form>`):'';
  const roster=['admin','instructor'].includes(role)?panel('Student access',table(['Student','Course access','Action'],[...new Set([...course.enrolledIds,...course.restrictedIds])].filter(id=>person(id)?.role==='student').map(studentId=>`<tr><td>${esc(person(studentId)?.name)}</td><td>${course.restrictedIds.includes(studentId)?badge('restricted'):badge(getCourseRole(state,course.id,studentId))}</td><td class="actions-cell">${button(course.restrictedIds.includes(studentId)?'restore-student':'remove-student',course.restrictedIds.includes(studentId)?'Restore access':'Remove',{course:id,student:studentId},course.restrictedIds.includes(studentId)?'small secondary':'small danger')}</td></tr>`))):'';
  return `<a class="breadcrumb" href="#/courses">← Courses</a>`+heading(course.code,course.title,`${badge(course.queueState)}<span class="muted">${entries.length} active</span>`)+`<div class="queue-layout"><aside>${left}</aside><div>${announcements}${queue}${join}${feedback}${work}${roster}</div></div>`;
}
function insights() {
  const views=getRoleViews(state);if(!views.canHire)return missing();
  const report=getInsights(state);
  const courses=state.courses.filter(item=>views.isAdmin||item.instructorId===actor().id);
  const scope=new Set(courses.map(item=>item.id));
  const since=Date.now()-30*86400000;
  const sessions=state.helpSessions.filter(item=>scope.has(item.courseId)&&new Date(item.joinedAt).getTime()>=since&&new Date(item.joinedAt).getTime()<=Date.now());
  const helped=sessions.filter(item=>item.wasHelped);
  const feedback=state.feedback.filter(item=>scope.has(item.courseId)&&item.ratingScope==='helper'&&new Date(item.createdAt).getTime()>=since);
  const waits=helped.map(item=>Number(item.waitMinutes)).filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
  const p90=waits.length?waits[Math.max(0,Math.ceil(waits.length*.9)-1)].toFixed(1):'0.0';
  const staffIds=[...new Set(report.courses.flatMap(item=>item.helpers.map(helper=>helper.actorId)))];
  const ratings=staffIds.map(id=>{const records=feedback.filter(item=>item.helperId===id);return {id,records,helped:report.courses.reduce((total,course)=>total+(course.helpers.find(helper=>helper.actorId===id)?.sessions||0),0),score:records.length?records.reduce((s,r)=>s+Number(r.rating),0)/records.length:null};}).sort((a,b)=>b.helped-a.helped);
  const courseRows=courses.map(course=>{
    const details=report.courses.find(item=>item.id===course.id);
    return `<tr><td><strong>${esc(course.code)}</strong><span class="muted">${esc(course.title)}</span></td><td>${details.requests}</td><td>${details.helped}</td><td>${details.approvedPositions}</td><td>${details.committedPositions}</td><td>${details.openPositions}</td><td>${link(`queue/${course.id}`,'Course','small secondary')}</td></tr>`;
  });
  const byHour=new Array(8).fill(0),matrix=Array.from({length:7},()=>new Array(8).fill(0));
  for(const course of report.courses)for(let day=0;day<7;day++)for(let hour=0;hour<8;hour++){const count=course.busyHours[day][hour+10];matrix[day][hour]+=count;byHour[hour]+=count;}
  const max=Math.max(1,...byHour),maxCell=Math.max(1,...matrix.flat());
  const chart=`<div class="chart-bars" role="img" aria-label="Recorded requests by hour">${byHour.map((value,index)=>`<div class="chart-bar" style="height:${Math.max(3,value/max*140)}px"><b>${value}</b><span>${index+10}:00</span></div>`).join('')}</div><p class="chart-caption">Eastern time · past 30 days · request arrivals, not attendance</p>`;
  const heat=`<div class="heatmap" role="img" aria-label="Recorded office-hours demand by weekday and hour"><span></span>${Array.from({length:8},(_,n)=>`<span class="hour">${n+10}</span>`).join('')}${matrix.map((row,day)=>`<span class="day">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]}</span>${row.map((count,hour)=>{const ratio=count/maxCell;return `<span class="cell" title="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day]} ${hour+10}:00: ${count} requests" style="background:${ratio>.7?'#012169':ratio>.45?'#476eb4':ratio>.2?'#cbd9f3':'#edf2fc'};color:${ratio>.45?'#fff':'#012169'}">${count}</span>`;}).join('')}`).join('')}</div>`;
  const helpers=table(['TA','Helped sessions','Rating','Evidence'],ratings.map(item=>`<tr><td><strong>${esc(person(item.id)?.name||'Recorded helper')}</strong></td><td>${item.helped}</td><td class="score">${item.score===null?'—':`${item.score.toFixed(1)} / 5`}</td><td>${item.records.length} ratings · ${new Set(item.records.map(r=>r.studentId)).size} reviewers<span class="muted">${item.records.length<5?'Limited sample':'Recorded observations'} · ${item.records.length?date(item.records[0].createdAt):'No feedback'}</span></td></tr>`));
  return heading(views.isAdmin?'Department Insights':'Course Insights',state.term.name)+`<div class="metric-row"><div class="metric"><span>Recorded requests</span><strong>${sessions.length}</strong><small>${courses.length} courses in scope</small></div><div class="metric"><span>Students helped</span><strong>${helped.length}</strong><small>Completed support sessions</small></div><div class="metric"><span>P90 wait</span><strong>${p90}<small> min</small></strong></div><div class="metric"><span>Linked feedback</span><strong>${feedback.filter(item=>item.helperId).length}</strong><small>Explicit helper attribution</small></div></div><div class="grid">${panel('When students need help',chart)}${panel('Weekly demand pattern',heat)}</div>${panel('Course staffing and demand',table(['Course','Requests','Helped','Approved seats','Reserved','Open seats','Action'],courseRows))}${panel('TA support and feedback',helpers,'<div class="section-note">Feedback supports follow-up; it does not establish a universal ranking of teaching quality.</div>')}${savedAi('term_review','AI course advice example')}`;
}
function missing(){return heading('Page unavailable')+`<p>This page is unavailable for the current identity.</p>${link('courses','Back to Courses')}`;}
function render() {
  if(!actor()){login();return;}
  const parts=route();
  let content;
  if(!parts.length||parts[0]==='courses')content=home();
  else if(parts[0]==='opportunities')content=parts[1]?positionDetail(parts[1]):opportunities();
  else if(parts[0]==='applications')content=parts[1]?applicationDetail(parts[1]):applications();
  else if(parts[0]==='staffing')content=parts[1]==='new'?newPosition():staffing(parts[1]);
  else if(parts[0]==='administration')content=administration();
  else if(parts[0]==='queue')content=queuePage(parts[1]);
  else if(parts[0]==='insights')content=insights();
  else content=missing();
  root.innerHTML=header()+navigation()+switcher()+`<main id="main" class="workspace">${notice?`<div class="notice ${noticeKind}" role="${noticeKind==='error'?'alert':'status'}">${esc(notice)}</div>`:''}${content}</main>`+footer();
}
function applicationValues(form) {
  const values=new FormData(form),existing=appBy(form.dataset.id);
  return { applicationId:existing?.id,opportunityId:form.dataset.position,profile:{...(existing?.profile||{}),firstName:values.get('firstName'),lastName:values.get('lastName'),preferredEmail:values.get('preferredEmail'),undergraduateMajors:values.get('undergraduateMajors'),availableHours:Number(values.get('availableHours')),availability:values.get('availability'),skills:values.get('skills'),positionPreference:'half'}, answers:Object.fromEntries([...values.entries()].filter(([key])=>key.startsWith('answer:')).map(([key,value])=>[key.slice(7),value])),qualificationText:values.get('qualificationText'),cv:values.get('cvName')?{name:values.get('cvName'),type:'text/plain',size:1024}:null};
}
root.addEventListener('click',event=>{
  const control=event.target.closest('[data-action]');if(!control||control.disabled)return;
  const {action}=control.dataset;
  if(action==='choose-role'){selectedRole=control.dataset.role;login();return;}
  if(action==='switch'){switchOpen=!switchOpen;render();if(switchOpen)document.querySelector('#switch-persona')?.focus();return;}
  if(action==='logout'){act('signOut',{},'');notice='';go('');render();return;}
  if(action==='reset'){if(confirm('Reset only this browser’s demo workspace?')){persist(createInitialState());notice='';switchOpen=false;search='';go('');render();}return;}
  if(action==='new-position'){go('staffing/new');return;}
  if(action==='sample-cv'){const form=control.closest('form');form.elements.cvName.value='campusworks-demo-cv.txt';form.querySelector('[data-cv-label]').textContent='campusworks-demo-cv.txt';return;}
  if(action==='save-application'){const form=control.closest('form');act('saveApplication',applicationValues(form),'Draft saved.');render();return;}
  if(action==='start-application'){
    const posting=positionBy(control.dataset.position),existing=state.applications.find(app=>app.opportunityId===posting.id&&app.applicantId===actor().id);
    if(existing){go(`applications/${existing.id}`);return;}
    if(act('saveApplication',{opportunityId:posting.id,profile:{firstName:actor().name.split(' ')[0],lastName:actor().name.split(' ').slice(1).join(' '),preferredEmail:actor().email,undergraduateMajors:'Computer Science',availableHours:10,positionPreference:'half'},answers:{},qualificationText:'',cv:null},'Draft created.'))go(`applications/${state.applications.find(app=>app.opportunityId===posting.id&&app.applicantId===actor().id).id}`);else render();return;
  }
  const commands={
    enroll:['enroll',{courseId:control.dataset.course,enroll:true},'Enrolled.'],
    'leave-course':['enroll',{courseId:control.dataset.course,enroll:false},'Course left.'],
    withdraw:['withdrawApplication',{applicationId:control.dataset.application},'Application withdrawn.'],
    'accept-offer':['respondOffer',{appointmentId:control.dataset.appointment,accept:true},'Offer accepted. Administrator clearance is next.'],
    'decline-offer':['respondOffer',{appointmentId:control.dataset.appointment,accept:false},'Offer declined.'],
    shortlist:['reviewApplication',{applicationId:control.dataset.application,decision:'shortlisted'},'Candidate shortlisted.'],
    select:['selectApplication',{applicationId:control.dataset.application},'Offer issued. The candidate can now respond.'],
    'publish-position':['publishOpportunity',{opportunityId:control.dataset.position},'Submitted for publication approval.'],
    'approve-position':['approveOpportunity',{opportunityId:control.dataset.position},'Position approved.'],
    'close-position':['closeOpportunity',{opportunityId:control.dataset.position},'Applications closed.'],
    'archive-position':['archiveOpportunity',{opportunityId:control.dataset.position},'Opening archived.'],
    'clear-appointment':['clearAppointment',{appointmentId:control.dataset.appointment,status:'cleared'},'Clearance recorded. Dated TA access updates automatically.'],
    'needs-information':['clearAppointment',{appointmentId:control.dataset.appointment,status:'needs_information'},'Appointment is awaiting information.'],
    'end-appointment':['endAppointment',{appointmentId:control.dataset.appointment,reason:'Demo appointment completed.'},'Appointment ended. Derived TA access was removed.'],
    'suspend-appointment':['suspendAppointment',{appointmentId:control.dataset.appointment,reason:'Demo scheduling review.'},'Appointment suspended.'],
    'resume-appointment':['resumeAppointment',{appointmentId:control.dataset.appointment},'Appointment resumed.'],
    'toggle-cycle':['setCycle',{enabled:!state.cycle.enabled},'Recruitment cycle updated.'],
    duty:['duty',{courseId:control.dataset.course,on:control.dataset.on==='true'},'Duty updated.'],
    'queue-open':['setQueueState',{courseId:control.dataset.course,status:'open'},'Queue opened.'],
    'queue-pause':['setQueueState',{courseId:control.dataset.course,status:'paused'},'Queue paused.'],
    'queue-close':['setQueueState',{courseId:control.dataset.course,status:'closed'},'Queue closed and active entries archived.'],
    'leave-queue':['leaveQueue',{courseId:control.dataset.course},'You left the queue.'],
    'remove-student':['removeStudent',{courseId:control.dataset.course,studentId:control.dataset.student},'Access restricted until an instructor or administrator restores it.'],
    'restore-student':['restoreStudent',{courseId:control.dataset.course,studentId:control.dataset.student},'Course access restriction removed.'],
    'queue-handoff':['queueAction',{entryId:control.dataset.entry,action:'handoff',helperId:control.dataset.helper},'Request handed to the other available helper.'],
  };
  if(action.startsWith('queue-')&&['claim','complete','pause-entry','resume','remove','up','down'].includes(action.slice(6)))commands[action]=['queueAction',{entryId:control.dataset.entry,action:action==='queue-pause-entry'?'pause':action.slice(6)},'Queue updated.'];
  if(commands[action]){const [type,data,message]=commands[action];act(type,data,message);render();}
});
root.addEventListener('submit',event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();const values=new FormData(form);
  if(['login','switch'].includes(form.dataset.form)){if(act('signIn',{actorId:values.get('actorId')},'')){notice='';switchOpen=false;go('courses');render();}return;}
  if(form.dataset.form==='application'){const data=applicationValues(form);if(act('saveApplication',data,'')){const app=state.applications.find(item=>item.opportunityId===data.opportunityId&&item.applicantId===actor().id);act('submitApplication',{applicationId:app.id},'Application submitted.');}render();return;}
  if(form.dataset.form==='position'){
    const ids=new Set(state.opportunities.map(item=>item.id));
    const input={type:values.get('type'),courseId:values.get('courseId'),title:values.get('title'),positions:Number(values.get('positions')),weeklyHours:Number(values.get('weeklyHours')),description:values.get('description'),requiredSkills:values.get('requiredSkills'),questions:[{id:'qualification',prompt:values.get('question'),required:true}],...Object.fromEntries(['attendanceRequired','labRequired','discussionRequired','gradingRequired','officeHoursRequired'].map(name=>[name,values.has(name)]))};
    if(act('createOpportunity',{input},'Position saved.')){const item=state.opportunities.find(item=>!ids.has(item.id));go(`staffing/${item.id}`);}else render();return;
  }
  if(form.dataset.form==='announcement')act('postAnnouncement',{courseId:form.dataset.course,message:values.get('message')},'Announcement posted.');
  if(form.dataset.form==='join-queue')act('joinQueue',{courseId:form.dataset.course,location:values.get('location'),question:values.get('question')},'You joined the queue.');
  if(form.dataset.form==='feedback')act('submitFeedback',{sessionId:form.dataset.session,rating:Number(values.get('rating')),positive:values.get('positive'),negative:values.get('negative')},'Feedback recorded for your helper.');
  if(form.dataset.form==='work')act('recordWork',{courseId:form.dataset.course,appointmentId:form.dataset.appointment||undefined,kind:values.get('kind'),hours:Number(values.get('hours')),notes:values.get('notes')},'Work recorded.');
  render();
});
root.addEventListener('change',event=>{
  if(event.target.dataset.filter==='type'){typeFilter=event.target.value;render();}
  if(event.target.dataset.file==='cv'){const file=event.target.files[0],form=event.target.closest('form');if(file){form.elements.cvName.value=file.name;form.querySelector('[data-cv-label]').textContent=file.name;}}
});
root.addEventListener('input',event=>{
  if(event.target.dataset.filter==='search'){search=event.target.value;const input=event.target;const start=input.selectionStart;render();const next=document.querySelector('[data-filter="search"]');next?.focus();next?.setSelectionRange(start,start);}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&switchOpen){switchOpen=false;render();document.querySelector('[data-action="switch"]')?.focus();}});
window.addEventListener('hashchange',()=>{notice='';render();window.scrollTo({top:0,behavior:'instant'});});
window.addEventListener('storage',event=>{if(event.key?.includes('campusworks')){try{state=loadState()||state;render();}catch{}}});
render();
