export const DEMO_CATALOG_VERSION = 4;
const DAY = 86400000;
const MINUTE = 60000;

export const DEMO_STAGE_ACTIONS = Object.freeze({
  draft: ['save'],
  draft_missing_cv: ['save'],
  draft_missing_answers: ['save', 'cv'],
  submitted: ['save', 'cv', 'submit'],
  under_review: ['save', 'cv', 'submit', 'review'],
  shortlisted: ['save', 'cv', 'submit', 'shortlist'],
  not_selected: ['save', 'cv', 'submit', 'reject'],
  withdrawn: ['save', 'cv', 'submit', 'withdraw'],
  offered: ['save', 'cv', 'submit', 'select', 'administrative'],
  pending_clearance: ['save', 'cv', 'submit', 'select', 'accept', 'administrative'],
  needs_information: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:needs_information'],
  active: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:cleared', 'workload'],
  pending_start: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:cleared'],
  suspended: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:cleared', 'workload', 'suspend'],
  ended_unsettled: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:cleared', 'workload', 'end'],
  ended_settled: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:cleared', 'workload', 'end', 'settle'],
  declined: ['save', 'cv', 'submit', 'select', 'decline'],
  rescinded: ['save', 'cv', 'submit', 'select', 'rescind'],
  not_cleared: ['save', 'cv', 'submit', 'select', 'accept', 'administrative', 'clearance:not_cleared'],
});

const studentNames = [
  ['Casey', 'Morgan'], ['Avery', 'Chen'], ['Jordan', 'Rivera'], ['Maya', 'Patel'],
  ['Noah', 'Brooks'], ['Sofia', 'Kim'], ['Ethan', 'Reed'], ['Leila', 'Bennett'],
  ['Owen', 'Park'], ['Aria', 'Shah'], ['Luca', 'Reyes'], ['Nora', 'Ellis'],
  ['Theo', 'Lin'], ['Zoe', 'Carter'], ['Amir', 'Stone'], ['Elena', 'Wells'],
  ['Miles', 'Tran'], ['Iris', 'Foster'], ['Felix', 'Young'], ['Chloe', 'Hart'],
  ['Leo', 'Adams'], ['Mina', 'Cole'], ['Finn', 'Davis'], ['Anika', 'Ross'],
  ['Jules', 'Grant'], ['Sara', 'Blake'], ['Kai', 'Mitchell'], ['Ada', 'Hayes'],
  ['Sam', 'Perry'], ['Lena', 'Scott'], ['Ezra', 'Price'], ['Riley', 'James'],
];

const courseDefinitions = [
  ['intro', 'cs101', 'Introduction to Programming', 'faculty-main', ['ta-main', 'ta-two'], 'open', 'Python, debugging and test design'],
  ['structures', 'cs201', 'Data Structures and Software Design', 'faculty-algorithms', ['ta-labs'], 'open', 'Java, recursion and data structures'],
  ['discrete', 'cs230', 'Discrete Mathematics for Computing', 'faculty-algorithms', ['ta-two'], 'paused', 'Proofs, combinatorics and clear explanations'],
  ['systems', 'cs250', 'Computer Systems and Architecture', 'faculty-systems', ['ta-main'], 'open', 'C, memory safety and systems debugging'],
  ['algorithms', 'cs301', 'Algorithms and Problem Solving', 'faculty-algorithms', ['ta-labs'], 'closed', 'Algorithms, complexity and proof writing'],
  ['databases', 'cs316', 'Database Systems', 'faculty-data', ['ta-data'], 'open', 'SQL, relational modeling and query planning'],
  ['ai', 'cs330', 'Introduction to Artificial Intelligence', 'faculty-data', ['ta-data'], 'open', 'Python, search and model evaluation'],
  ['software', 'cs350', 'Software Engineering Studio', 'faculty-systems', ['ta-labs'], 'closed', 'Testing, Git and collaborative development'],
  ['interaction', 'cs210', 'Human-Centered Computing', 'faculty-systems', ['ta-two'], 'open', 'Accessibility, interaction design and user studies'],
  ['data-science', 'cs220', 'Foundations of Data Science', 'faculty-data', ['ta-data'], 'paused', 'Python, statistics and data visualization'],
];

/** Pure, repeatable synthetic specifications. API loaders assign real record IDs. */
export function createDemoCatalog(referenceTime = new Date(), { primaryCourse = 'cs101' } = {}) {
  const instant = new Date(referenceTime);
  if (!Number.isFinite(instant.getTime())) throw new Error('A valid demonstration reference time is required.');
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(primaryCourse)) throw new Error('The primary course code is invalid.');
  if (courseDefinitions.slice(1).some(course => course[1] === primaryCourse)) throw new Error('The primary course code must be unique.');
  const timestamp = instant.getTime();
  const at = (days, minutes = 0) => new Date(timestamp + days * DAY + minutes * MINUTE).toISOString();
  const year = instant.getUTCFullYear();
  const season = instant.getUTCMonth() >= 7 ? 'Fall' : instant.getUTCMonth() >= 5 ? 'Summer' : 'Spring';
  const actors = [
    { key: 'admin', role: 'admin', email: 'admin@example.com', name: 'Morgan Ellis' },
    { key: 'faculty-main', role: 'instructor', email: 'instructor@example.com', name: 'Prof. Taylor Reed' },
    { key: 'faculty-algorithms', role: 'instructor', email: 'faculty-algorithms@example.com', name: 'Prof. Cameron Wells' },
    { key: 'faculty-data', role: 'instructor', email: 'faculty-data@example.com', name: 'Prof. Jamie Chen' },
    { key: 'faculty-systems', role: 'instructor', email: 'faculty-systems@example.com', name: 'Prof. Alex Rivera' },
    { key: 'ta-main', role: 'ta', email: 'ta@example.com', name: 'Robin Parker' },
    { key: 'ta-two', role: 'ta', email: 'ta2@example.com', name: 'Drew Campbell' },
    { key: 'ta-labs', role: 'ta', email: 'ta-labs@example.com', name: 'Quinn Bennett' },
    { key: 'ta-data', role: 'ta', email: 'ta-data@example.com', name: 'Skyler Lane' },
    ...studentNames.map(([firstName, lastName], index) => ({
      key: index < 3 ? ['student-main', 'student-two', 'student-three'][index] : `candidate-${String(index + 1).padStart(2, '0')}`,
      email: index < 3 ? ['student@example.com', 'student2@example.com', 'student3@example.com'][index] : `demo-${firstName.toLowerCase()}-${lastName.toLowerCase()}@example.com`,
      name: `${firstName} ${lastName}`, firstName, lastName, role: 'student',
    })),
  ];
  const actorByKey = new Map(actors.map(actor => [actor.key, actor]));
  const terms = {
    current: { name: `${season} ${year} · Demo`, startDate: at(-30), endDate: at(90), requiresApproval: true },
    previous: { name: `Previous semester · Demo ${year}`, startDate: at(-240), endDate: at(-120), requiresApproval: true },
  };
  const cycle = { termKey: 'current', enabled: true, opensAt: at(-14), closesAt: at(14) };
  const courses = courseDefinitions.map(([key, code, title, instructorKey, taKeys, queueState, skills], index) => ({
    key, code: key === 'intro' ? primaryCourse : code, title, instructorKey, taKeys: [...taKeys], queueState, skills,
    studentKeys: studentNames.map((_, student) => actors[9 + student].key).filter((_, student) => student < 3 || (student + index) % 3 !== 0),
    announcements: [
      `${title}: ${queueState === 'open' ? 'office hours are open' : queueState === 'paused' ? 'the queue is paused for the next session' : 'the next office-hours session opens tomorrow'}. Please include your question and location.`,
      ['Bring a small reproducible example so we can focus on your reasoning.', 'We will review the practice worksheet before the next problem set.', 'Use the posted rubric and note which step needs clarification.'][index % 3],
    ],
  }));
  const courseByKey = new Map(courses.map(course => [course.key, course]));
  const definitions = [
    ['intro-ta', 'intro', 'faculty-main', 'published', 3, 'Programming Foundations TA'],
    ['structures-ta', 'structures', 'faculty-algorithms', 'published', 3, 'Data Structures TA'],
    ['discrete-ta', 'discrete', 'faculty-algorithms', 'published', 2, 'Discrete Mathematics Discussion TA'],
    ['systems-ta', 'systems', 'faculty-systems', 'published', 3, 'Systems Lab TA'],
    ['algorithms-ta', 'algorithms', 'faculty-algorithms', 'applications_closed', 2, 'Algorithms Discussion TA'],
    ['databases-ta', 'databases', 'faculty-data', 'published', 3, 'Database Systems TA'],
    ['ai-ta', 'ai', 'faculty-data', 'filled', 1, 'AI Evaluation and Grading TA'],
    ['software-ta', 'software', 'faculty-systems', 'published', 2, 'Software Engineering Studio TA'],
    ['interaction-ta', 'interaction', 'faculty-systems', 'published', 2, 'Human-Centered Computing TA'],
    ['data-science-ta', 'data-science', 'faculty-data', 'published', 2, 'Data Science Lab TA'],
    ['structures-lab-plan', 'structures', 'faculty-algorithms', 'pending_approval', 2, 'Data Structures Lab Expansion'],
    ['ai-grading-plan', 'ai', 'faculty-data', 'draft', 1, 'AI Grading Support'],
    ['systems-closeout', 'systems', 'faculty-systems', 'archived', 1, 'Systems Bootcamp Closeout'],
    ['ra-data-quality', '', 'faculty-data', 'published', 2, 'RA · Data Quality and Evaluation'],
    ['ra-systems', '', 'faculty-systems', 'published', 2, 'RA · Systems Benchmarking'],
    ['ra-learning', '', 'faculty-algorithms', 'applications_closed', 2, 'RA · Learning Analytics'],
    ['ra-distributed-plan', '', 'faculty-systems', 'draft', 1, 'RA · Distributed Data Preparation'],
    ['ra-evaluation-plan', '', 'faculty-data', 'pending_approval', 1, 'RA · Evaluation Protocol Support'],
    ['intro-closeout', 'intro', 'faculty-main', 'archived', 1, 'Programming Workshop Closeout'],
    ['database-clinic', 'databases', 'faculty-data', 'cancelled', 1, 'Database Clinic Reserve'],
    ['database-future', 'databases', 'faculty-data', 'filled', 1, 'Database TA · Next Session'],
  ];
  const opportunities = definitions.map(([key, courseKey, ownerKey, stage, positions, title], index) => {
    const type = courseKey ? 'ta' : 'ra';
    const course = courseByKey.get(courseKey);
    const future = key === 'database-future';
    const appointmentStart = at(future ? 14 : -21);
    const appointmentEnd = at(future ? 70 : 49);
    const weeklyHours = 10;
    const hourlyRate = [22, 24, 25, 26][index % 4];
    const weeks = Math.ceil((new Date(appointmentEnd) - new Date(appointmentStart)) / (7 * DAY));
    const appointmentCost = weeklyHours * hourlyRate * weeks;
    const grading = type === 'ta' && !['discrete', 'interaction'].includes(courseKey);
    const lab = type === 'ta' && ['intro', 'systems', 'databases', 'data-science'].includes(courseKey);
    return { key, ownerKey, courseKey, termKey: 'current', stage, input: {
      type, title, department: 'Computer Science', courseId: course?.code || '',
      description: type === 'ta' ? `Support ${course.title.toLowerCase()} through clear explanations, consistent feedback and scheduled student support.` : `Assist with ${title.split(' · ')[1].toLowerCase()} using reproducible methods, careful documentation and weekly faculty check-ins.`,
      positions, weeklyHours, appointmentStart, appointmentEnd, applicationDeadline: cycle.closesAt,
      requiresAttendance: type === 'ta', hasLab: lab, hasDiscussion: type === 'ta' && !lab,
      requiresGrading: grading, holdsOfficeHours: type === 'ta',
      duties: type === 'ta' ? [
        { kind: 'office_hours', sessionsPerWeek: 2, minutesPerSession: 60 },
        { kind: lab ? 'lab' : 'discussion', sessionsPerWeek: 1, minutesPerSession: 60 },
        { kind: grading ? 'grading' : 'preparation', sessionsPerWeek: 2, minutesPerSession: 90 },
      ] : [{ kind: 'research', sessionsPerWeek: 2, minutesPerSession: 180 }, { kind: 'coordination', sessionsPerWeek: 1, minutesPerSession: 60 }],
      requiredSkills: course?.skills || (key.includes('systems') ? 'Python, reproducible experiments and systems measurements' : 'Python, data validation and careful technical writing'),
      preferredSkills: type === 'ta' ? 'Peer tutoring, rubric-based feedback and collaborative communication' : 'Version control, reproducibility and collaborative documentation',
      requiredSlots: type === 'ta' ? [{ day: 2, start: '14:00', end: '15:00' }] : [],
      questions: [
        { id: 'experience', prompt: 'Relevant preparation?', purpose: 'qualification', required: true },
        { id: 'approach', prompt: type === 'ta' ? 'Teaching approach?' : 'Verification approach?', purpose: 'qualification', required: true },
        { id: 'availability', prompt: 'Weekly availability?', purpose: 'qualification', required: true },
      ],
      allowedPositionPreferences: ['half', 'either'], cvRequired: true, approvalRequired: true,
      hourlyRate, budget: Math.ceil(appointmentCost * positions * 1.12 / 100) * 100,
    } };
  });
  const opportunityByKey = new Map(opportunities.map(opportunity => [opportunity.key, opportunity]));
  const applications = [];
  const add = (actorKey, opportunityKey, stage = 'submitted', variant = 0) => {
    const actor = actorByKey.get(actorKey);
    const opportunity = opportunityByKey.get(opportunityKey);
    if (!actor || !opportunity) throw new Error('The demonstration application has an invalid reference.');
    const prior = Number(actorKey.replace('candidate-', '')) % 3 === 0;
    const strength = variant % 3;
    const experience = (opportunity.input.type === 'ta' ? [
      'Led peer study sessions.',
      'Built a tested course project.',
      'Reviewed team project code.',
    ] : [
      'Documented reproducible experiments.',
      'Built a tested data pipeline.',
      'Reviewed evaluation scripts.',
    ])[strength];
    const profile = {
      firstName: actor.firstName, lastName: actor.lastName, preferredEmail: actor.email,
      undergraduateMajors: strength === 2 ? 'Computer Science and Mathematics' : 'Computer Science', department: 'Computer Science',
      positionPreference: variant % 2 ? 'either' : 'half', priorTaExperience: prior,
      priorCourses: prior ? 'Programming and data-structures peer support.' : '',
      multipleCourses: false, graduationTerm: `Spring ${year + 1}`,
      availability: 'Tuesday and Thursday afternoons; the required Tuesday 14:00-15:00 session is available.',
      availableHours: 10 + (variant % 3) * 5,
      slots: [{ day: 1, start: '09:00', end: '12:00' }, { day: 2, start: '13:00', end: '17:00' }, { day: 4, start: '13:00', end: '17:00' }],
      skills: opportunity.input.requiredSkills,
      experience,
    };
    const answers = {
      experience: ['Tested recursion edge cases.', 'Compared two solution designs.', 'Revised project instructions.'][strength],
      approach: (opportunity.input.type === 'ta' ? [
        'Trace one example, give a hint, then check understanding.',
        'Ask the student to predict a small program\'s output.',
        'Compare solutions and check the student\'s reasoning.',
      ] : [
        'Record inputs and configuration, compare a baseline, and document limitations.',
        'Repeat the run with fixed inputs and investigate any discrepancy.',
        'Check a held-out example and preserve the reproducible command.',
      ])[strength],
      availability: `Tue 14:00-15:00; ${profile.availableHours}h/week.`,
    };
    if (stage === 'draft_missing_answers') delete answers.approach;
    const key = `${actorKey}--${opportunityKey}`;
    if (applications.some(application => application.key === key)) return;
    applications.push({ key, actorKey, opportunityKey, stage, seedActions: [...DEMO_STAGE_ACTIONS[stage]], profile, answers,
      qualificationText: `Synthetic qualification record. ${['Explains with diagrams.', 'Documents assumptions.', 'Checks boundary cases.'][strength]}`,
      cv: stage === 'draft_missing_cv' ? null : { name: `${actor.firstName.toLowerCase()}-${actor.lastName.toLowerCase()}-demo-cv.txt`, text: `SYNTHETIC DEMONSTRATION CV\n${actor.name}\nComputer Science\nSkills: ${profile.skills}\nExperience: ${experience}\nAvailability: ${profile.availability}\nNo real individual or academic result is represented.\n` },
      administrative: { dukeUniqueId: `DEMO-${String(actors.indexOf(actor)).padStart(4, '0')}`, payrollBefore: false, hasSsn: false, citizenship: '', authorizationExpiry: '' },
      reason: ({ not_selected: 'The current opening prioritizes experience with the published lab workload.', needs_information: 'Synthetic clearance checklist: appointment information is awaiting confirmation.', suspended: 'Synthetic temporary scheduling review; independent course grants are preserved.', ended_unsettled: 'The workshop has ended; approved incurred costs are awaiting settlement.', ended_settled: 'The workshop is complete and its approved incurred costs are settled.', declined: 'The candidate chose to keep the semester schedule available.', rescinded: 'The planned support schedule changed before acceptance.', not_cleared: 'Synthetic clearance scenario; no real administrative determination.' })[stage] || '',
      settlementRatio: stage === 'ended_settled' ? 0.68 : undefined,
    });
  };
  for (let number = 4; number <= 15; number++) add(`candidate-${String(number).padStart(2, '0')}`, 'intro-ta', number % 5 === 0 ? 'shortlisted' : number % 4 === 0 ? 'under_review' : 'submitted', number);
  for (const [key, stage] of [['software-ta', 'submitted'], ['structures-ta', 'offered'], ['discrete-ta', 'under_review'], ['systems-ta', 'shortlisted'], ['databases-ta', 'submitted'], ['ra-data-quality', 'submitted'], ['ra-systems', 'submitted']]) add('student-two', key, stage, 1);
  const pools = [
    ['structures-ta', [4, 7, 10, 13]], ['algorithms-ta', [5, 8, 11, 14]],
    ['databases-ta', [6, 9, 12, 15]], ['software-ta', [4, 8, 12]],
    ['interaction-ta', [5, 9, 13]], ['data-science-ta', [6, 10, 14]],
    ['ra-data-quality', [7, 11, 15]], ['ra-systems', [4, 9, 14]], ['ra-learning', [5, 10, 15]],
  ];
  for (const [opportunityKey, candidates] of pools) for (const [index, number] of candidates.entries()) add(`candidate-${String(number).padStart(2, '0')}`, opportunityKey, index === 0 ? 'shortlisted' : index === 1 ? 'under_review' : 'submitted', number);
  const lifecycle = [
    [16, 'discrete-ta', 'pending_clearance'], [17, 'systems-ta', 'needs_information'],
    [18, 'ai-ta', 'active'], [19, 'intro-ta', 'active'], [20, 'database-future', 'pending_start'],
    [21, 'software-ta', 'suspended'], [22, 'ra-data-quality', 'active'], [23, 'ra-systems', 'offered'],
    [24, 'ra-learning', 'needs_information'], [25, 'systems-closeout', 'ended_unsettled'],
    [26, 'intro-closeout', 'ended_settled'], [27, 'interaction-ta', 'declined'],
    [28, 'data-science-ta', 'rescinded'], [29, 'databases-ta', 'not_cleared'],
    [30, 'systems-ta', 'withdrawn'], [31, 'structures-ta', 'not_selected'],
    [32, 'ra-data-quality', 'draft_missing_cv'],
  ];
  for (const [number, opportunityKey, stage] of lifecycle) add(`candidate-${number}`, opportunityKey, stage, number);
  add('student-three', 'intro-ta', 'draft_missing_answers', 2);
  add('student-main', 'discrete-ta', 'draft_missing_cv');

  const workloads = applications.filter(application => application.seedActions.includes('workload') && opportunityByKey.get(application.opportunityKey).input.type === 'ta').flatMap((application, index) => Array.from({ length: 6 }, (_, row) => ({
    key: `${application.key}--work-${row}`, applicationKey: application.key, date: at(-2 - row * 3).slice(0, 10),
    kind: ['office_hours', 'grading', 'lab', 'preparation', 'discussion', 'coordination'][row],
    hours: [2, 1.5, 1, 1.25, 1, 0.5][(row + index) % 6],
    notes: ['Worked through representative questions and checked understanding.', 'Applied the published rubric and documented common misconceptions.', 'Supported the scheduled lab and collected recurring questions.', 'Prepared examples and checked the next worksheet.', 'Facilitated discussion with short reasoning exercises.', 'Coordinated handoffs and the next support session.'][row],
  })));
  const questions = [
    'Why does my loop skip the final element?', 'How do I design tests for an empty input?', 'Can we walk through a recursive call stack?', 'Why is my SQL join duplicating rows?',
    'How should I compare two algorithmic approaches?', 'Can you help me interpret a memory error?', 'How can I make this interaction keyboard accessible?', 'What would be a fair baseline for this experiment?',
  ];
  const queuePlans = [
    { courseKey: 'intro', entries: [
      { actorKey: 'student-main', location: 'Learning Studio · Table 3', question: questions[0], state: 'waiting' },
      { actorKey: 'candidate-04', location: 'Online · Breakout A', question: questions[1], state: 'helping', helperKey: 'ta-main' },
      { actorKey: 'candidate-07', location: 'Learning Studio · Table 6', question: questions[2], state: 'paused' },
      { actorKey: 'candidate-10', location: 'Online · Breakout B', question: 'How can I explain the difference between mutation and reassignment?', state: 'waiting' },
      { actorKey: 'candidate-12', location: 'Learning Studio · Table 2', question: 'Which boundary cases should I test first?', state: 'helping', helperKey: 'ta-two' },
      { actorKey: 'candidate-14', location: 'Online · Breakout C', question: 'My tests pass separately but fail together. What should I inspect?', state: 'waiting' },
    ] },
    { courseKey: 'structures', entries: [
      { actorKey: 'candidate-05', location: 'Computing Lab · Seat 8', question: questions[2], state: 'waiting' },
      { actorKey: 'candidate-08', location: 'Online · Breakout A', question: 'When is a hash table a better choice than a balanced tree?', state: 'helping', helperKey: 'ta-labs' },
      { actorKey: 'candidate-11', location: 'Computing Lab · Seat 12', question: 'How do I test an iterator after the collection changes?', state: 'waiting' },
    ] },
    { courseKey: 'databases', entries: [
      { actorKey: 'candidate-06', location: 'Online · SQL Clinic', question: questions[3], state: 'helping', helperKey: 'ta-data' },
      { actorKey: 'candidate-09', location: 'Computing Lab · Seat 5', question: 'Why does this query plan stop using the index?', state: 'waiting' },
    ] },
  ];
  const history = courses.flatMap((course, courseIndex) => ['current', 'previous'].flatMap((termKey, period) => Array.from({ length: period ? 14 : 24 }, (_, index) => {
    const day = period ? -128 - index * 6 : -1 - index;
    const joinedAt = new Date(timestamp + day * DAY + ((index * 37 + courseIndex * 11) % 240) * MINUTE);
    const helped = index % 9 !== 8;
    const waitMinutes = 3 + ((index * 7 + courseIndex * 3) % 23) + (!period && ['intro', 'databases'].includes(course.key) && index % 6 === 0 ? 12 : 0);
    const helpMinutes = helped ? 6 + ((index * 5 + courseIndex) % 18) : 0;
    const helpStartAt = helped ? new Date(joinedAt.getTime() + waitMinutes * MINUTE) : null;
    const leftQueueAt = new Date((helpStartAt?.getTime() || joinedAt.getTime() + 18 * MINUTE) + helpMinutes * MINUTE);
    return { key: `${course.key}-${termKey}-session-${String(index + 1).padStart(2, '0')}`, courseKey: course.key, termKey,
      actorKey: `candidate-${String(4 + (index % 12)).padStart(2, '0')}`, helperKey: course.taKeys[index % course.taKeys.length],
      location: index % 2 ? 'Online office hours' : 'Learning Studio', question: questions[(index + courseIndex) % questions.length],
      joinedAt: joinedAt.toISOString(), helpStartAt: helpStartAt?.toISOString() || null, helpEndAt: helped ? leftQueueAt.toISOString() : null,
      closedAt: helped ? leftQueueAt.toISOString() : null, leftQueueAt: leftQueueAt.toISOString(),
      waitMinutes: helped ? waitMinutes : null, helpMinutes, wasHelped: helped, endReason: helped ? 'completed' : 'left',
    };
  })));
  const feedback = courses.flatMap((course, courseIndex) => Array.from({ length: 8 }, (_, index) => ({
    key: `${course.key}-feedback-${index}`, courseKey: course.key, termKey: 'current',
    actorKey: `candidate-${String(4 + index).padStart(2, '0')}`, category: ['queue', 'ta', 'wait', 'other'][index % 4],
    rating: index % 5 === 0 ? 3 : index % 3 === 0 ? 4 : 5,
    positive: ['The worked example made the reasoning clear.', 'Seeing the queue position helped me plan my work.', 'The TA asked questions that helped me find the issue.', 'The discussion connected the lab to the main course ideas.'][index % 4],
    negative: ['The queue was longer just before the assignment deadline.', 'I would benefit from an earlier practice example.', 'A short recap of the most common questions would help.', 'The online and in-person schedules could be easier to compare.'][(index + courseIndex) % 4],
    allowContact: index % 3 === 0, createdAt: at(-1 - index * 3, -courseIndex * 7),
  })));
  return {
    version: DEMO_CATALOG_VERSION, synthetic: true, marker: `campusworks-showcase-v${DEMO_CATALOG_VERSION}`, referenceTime: instant.toISOString(),
    disclosure: 'All people, qualifications, appointments, workload, feedback and queue observations are synthetic demonstration records.',
    actors, terms, cycle, courses, opportunities, applications, workloads, queuePlans, history, feedback,
    featured: { courseKey: 'intro', opportunityKey: 'intro-ta', applicantKey: 'student-two', applicationKey: 'student-two--structures-ta',
      eligibleCandidateKeys: Array.from({ length: 12 }, (_, index) => `candidate-${String(index + 4).padStart(2, '0')}`),
      reviewerKey: 'faculty-main', administratorKey: 'admin', queueStudentKey: 'student-main' },
    presentation: [
      { key: 'overview', roleKey: 'admin', path: '/courses', title: 'One view of courses, recruiting and operational readiness' },
      { key: 'apply', roleKey: 'student-two', path: '/applications', title: 'A candidate follows applications and an outstanding offer' },
      { key: 'compare', roleKey: 'faculty-main', opportunityKey: 'intro-ta', title: 'A twelve-person eligible pool with evidence-linked candidate pages' },
      { key: 'clearance', roleKey: 'admin', path: '/admin/staffing', title: 'Approval, clearance, future starts and financial closeout' },
      { key: 'queue', roleKey: 'ta-main', courseKey: 'intro', title: 'Live student support with claims, pauses and handoffs' },
      { key: 'review', roleKey: 'faculty-main', courseKey: 'intro', title: 'Recorded demand, feedback, workload and conditional staffing scenarios' },
    ],
  };
}
