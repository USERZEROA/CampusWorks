<script setup lang="ts">
const props = defineProps<{ opportunityId?: string }>()
const { data, error } = await useStaffingOverview('staffing-create')
const { busy, message, failure, run } = useStaffingMutation()
const form = reactive({title:'',type:'ta',courseId:'',projectId:'',termId:'',department:'Computer Science',description:'',positions:1,weeklyHours:10,appointmentStart:'',appointmentEnd:'',applicationDeadline:'',requiresAttendance:false,hasLab:false,hasDiscussion:false,requiresGrading:false,holdsOfficeHours:true,requiredSkills:'',preferredSkills:'',cvRequired:true,hourlyRate:20,budget:10000,approvalRequired:true,allowedPositionPreferences:['full','half','either','other'],duties:[{kind:'office_hours',sessionsPerWeek:1,minutesPerSession:60}],questions:[] as Array<{id:string,prompt:string,required:boolean}>,requiredSlots:[] as Array<{day:number,start:string,end:string}>})
const courses = computed(() => (data.value?.courses || []).filter((c:any) => data.value?.viewer?.isGlobalAdmin || ['instructor','admin'].includes(c.role || c.primaryRole)))
const originalVersion = ref<number | undefined>()
if (props.opportunityId) {
  const current = await useRequestFetch()<any>(`/api/staffing/opportunities/${props.opportunityId}`)
  const item = current.opportunity
  Object.assign(form, item)
  originalVersion.value = item.version
  const local = (value: string) => { const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
  form.appointmentStart = local(item.appointmentStart)
  form.appointmentEnd = local(item.appointmentEnd)
  form.applicationDeadline = local(item.applicationDeadline)
}
const iso = (value: string) => value ? new Date(value).toISOString() : ''
async function save() {
  const result = await run(() => $fetch<any>(props.opportunityId ? `/api/staffing/opportunities/${props.opportunityId}` : '/api/staffing/opportunities',{method:props.opportunityId ? 'PATCH' : 'POST',body:{...form,expectedVersion:originalVersion.value,courseId:form.type === 'ta' ? form.courseId : undefined,projectId:form.type === 'ra' ? form.projectId : undefined,appointmentStart:iso(form.appointmentStart),appointmentEnd:iso(form.appointmentEnd),applicationDeadline:iso(form.applicationDeadline)}}),'Opportunity draft created.')
  if (result?.opportunity) await navigateTo(`/staffing/${result.opportunity.id}`)
}
function addQuestion() { form.questions.push({id:`question-${Date.now()}-${form.questions.length}`,prompt:'',required:true}) }
</script>
<template>
  <StaffingShell :title="props.opportunityId ? 'Edit Opportunity Draft' : 'Create Opportunity'" subtitle="Set clear weekly duties, qualification criteria, appointment dates, and approved capacity.">
    <p v-if="error" class="notice error" role="alert">{{ apiErrorMessage(error, 'Unable to load staffing configuration.') }}</p>
    <p v-if="message" class="notice" :class="{error:failure}" role="status">{{ message }}</p>
    <p v-if="!data?.terms?.length" class="notice">An administrator must <NuxtLink to="/admin/staffing">create a term</NuxtLink> before you can publish an opportunity.</p>
    <form v-if="data?.viewer?.canManageStaffing" @submit.prevent="save" class="panel" :aria-busy="busy"><div class="panel-heading"><h2>Opportunity Details</h2></div><div class="panel-body"><fieldset :disabled="busy"><legend>Scope and schedule</legend><div class="grid">
      <label>Title<input v-model="form.title" required maxlength="200" data-testid="opportunity-title" /></label>
      <label>Appointment type<select v-model="form.type" data-testid="opportunity-type"><option value="ta">Teaching Assistant</option><option value="ra">Research Assistant</option></select></label>
      <label>Term<select v-model="form.termId" required data-testid="opportunity-term"><option value="">Choose a term</option><option v-for="term in data.terms" :key="term.id" :value="term.id">{{ term.name }}</option></select></label>
      <label v-if="form.type === 'ta'">Course offering<select v-model="form.courseId" required data-testid="opportunity-course"><option value="">Choose a course</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.code }} — {{ course.title }}</option></select></label>
      <label v-else>Research project<select v-model="form.projectId" required data-testid="opportunity-project"><option value="">Choose a project</option><option v-for="project in data.projects || []" :key="project.id" :value="project.id">{{ project.title }}</option></select></label>
      <label>Department<input v-model="form.department" required maxlength="200" /></label><label>Positions<input v-model.number="form.positions" type="number" min="1" max="100" required data-testid="opportunity-positions" /></label>
      <label>Weekly hours<input v-model.number="form.weeklyHours" type="number" min="1" max="80" required data-testid="opportunity-hours" /></label>
      <label>Appointment start (your local time)<input v-model="form.appointmentStart" type="datetime-local" required data-testid="opportunity-start" /></label>
      <label>Appointment end (your local time)<input v-model="form.appointmentEnd" type="datetime-local" required data-testid="opportunity-end" /></label>
      <label>Application deadline (your local time)<input v-model="form.applicationDeadline" type="datetime-local" required data-testid="opportunity-deadline" /></label>
    </div><label>Description<textarea v-model="form.description" required maxlength="6000" data-testid="opportunity-description" /></label></fieldset>
    <fieldset :disabled="busy"><legend>Weekly work expectations</legend><div class="grid"><label class="check"><input v-model="form.requiresAttendance" type="checkbox" />Attendance required</label><label class="check"><input v-model="form.hasLab" type="checkbox" />Lab responsibilities</label><label class="check"><input v-model="form.hasDiscussion" type="checkbox" />Discussion sections</label><label class="check"><input v-model="form.requiresGrading" type="checkbox" />Assignment or exam grading</label><label class="check"><input v-model="form.holdsOfficeHours" type="checkbox" />Hold office hours</label></div>
      <div v-for="(duty,index) in form.duties" :key="index" class="grid"><label>Duty {{ index + 1 }}<select v-model="duty.kind"><option value="attendance">Attendance</option><option value="lab">Lab</option><option value="discussion">Discussion</option><option value="grading">Grading</option><option value="office_hours">Office hours</option><option value="preparation">Preparation</option><option value="research">Research</option></select></label><label>Sessions per week<input v-model.number="duty.sessionsPerWeek" type="number" min="0" max="40" required /></label><label>Minutes per session<input v-model.number="duty.minutesPerSession" type="number" min="1" max="1440" required /></label><button type="button" class="danger" @click="form.duties.splice(index,1)" :aria-label="`Remove duty ${index+1}`">Remove duty</button></div>
      <button type="button" class="secondary" @click="form.duties.push({kind:'preparation',sessionsPerWeek:1,minutesPerSession:60})">Add weekly duty</button>
      <h3>Required fixed schedule</h3><p class="muted">Leave empty when times are flexible. Applicants must confirm coverage of any required slots.</p>
      <div v-for="(slot,index) in form.requiredSlots" :key="index" class="grid"><label>Day<select v-model.number="slot.day"><option v-for="(day,n) in ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']" :key="day" :value="n">{{ day }}</option></select></label><label>Start time<input v-model="slot.start" type="time" required /></label><label>End time<input v-model="slot.end" type="time" required /></label><button type="button" class="danger" @click="form.requiredSlots.splice(index,1)">Remove schedule slot</button></div><button type="button" class="secondary" @click="form.requiredSlots.push({day:1,start:'09:00',end:'10:00'})">Add required schedule slot</button>
    </fieldset>
    <fieldset :disabled="busy"><legend>Qualifications and application</legend><label>Required skills<textarea v-model="form.requiredSkills" required maxlength="4000" data-testid="opportunity-required-skills" /></label><label>Preferred skills<textarea v-model="form.preferredSkills" maxlength="4000" /></label><label class="check"><input v-model="form.cvRequired" type="checkbox" />Require a CV</label><div v-for="(question,index) in form.questions" :key="question.id"><label>Question {{ index+1 }}<input v-model="question.prompt" required maxlength="1000" /></label><label class="check"><input v-model="question.required" type="checkbox" />Answer required</label><button type="button" class="danger" @click="form.questions.splice(index,1)">Remove question {{ index+1 }}</button></div><button type="button" class="secondary" @click="addQuestion" data-testid="opportunity-add-question">Add screening question</button></fieldset>
    <fieldset :disabled="busy"><legend>Budget and approval</legend><div class="grid"><label>Hourly rate<input v-model.number="form.hourlyRate" type="number" min="0" step="0.01" required data-testid="opportunity-rate" /></label><label>Total approved budget<input v-model.number="form.budget" type="number" min="0" step="0.01" required data-testid="opportunity-budget" /></label></div><label class="check"><input v-model="form.approvalRequired" type="checkbox" />Department approval required before publication</label><p class="muted">The budget must cover all published positions for the appointment period. Zero-cost plans need an explicit approved cost basis; recorded queue use alone does not establish staffing cost.</p></fieldset>
    <button type="submit" :disabled="busy" data-testid="opportunity-save">{{ busy ? 'Saving…' : (props.opportunityId ? 'Save changes' : 'Save opportunity draft') }}</button></div></form>
    <p v-else-if="!error" class="notice">You do not currently manage a course or research project.</p>
  </StaffingShell>
</template>
