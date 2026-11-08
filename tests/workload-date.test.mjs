import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { courseDate } from "../shared/course-time.ts";

const observedAt = "2026-11-08T04:33:00Z";
class ObservationClock extends Date {
  constructor(value) {
    super(value === undefined ? observedAt : value);
  }
  static now() {
    return Date.parse(observedAt);
  }
}
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

test("course work dates follow Eastern midnight and both DST transitions", () => {
  for (const [instant, expected] of [
    [observedAt, "2026-11-07"],
    ["2026-11-08T05:00:00Z", "2026-11-08"],
    ["2026-03-09T03:59:00Z", "2026-03-08"],
    ["2026-03-09T04:00:00Z", "2026-03-09"],
    ["2026-11-02T04:59:00Z", "2026-11-01"],
    ["2026-11-02T05:00:00Z", "2026-11-02"],
  ]) assert.equal(courseDate(instant), expected);
});

test("the workload form saves its Eastern default date after UTC midnight", async () => {
  const component = readFileSync("app/components/WorkloadRecorder.vue", "utf8");
  const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*;\s*$/gm, "");
  const requests = [];
  const { observation, save } = new Function(
    "courseDate", "Date", "defineProps", "useStaffingMutation", "reactive", "staffingRequest", "crypto",
    compile(script) + "\nreturn { observation, save };",
  )(
    courseDate,
    ObservationClock,
    () => ({ appointmentId: "appointment" }),
    () => ({ run: (operation) => operation() }),
    (value) => value,
    async (_path, options) => { requests.push(options.body); return { record: options.body }; },
    { randomUUID: () => "work-observation" },
  );
  assert.equal(observation.date, "2026-11-07");
  observation.hours = 0.5;
  await save();
  assert.equal(requests[0].date, "2026-11-07");
  assert.equal(requests[0].hours, 0.5);
  assert.match(component, /Work date \(Eastern Time\)/);
});

function workloadService() {
  const source = readFileSync("server/utils/staffing-reports.ts", "utf8");
  const parsed = ts.createSourceFile("staffing-reports.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "recordWorkload");
  const appointment = {
    id: "appointment", type: "ta", status: "active", applicantId: "worker", applicantEmail: "alex@example.com",
    opportunityId: "posting", courseId: "cs201", termId: "fall",
    startDate: new Date("2026-11-08T04:00:00Z"), endDate: new Date("2026-11-12T05:00:00Z"),
  };
  const records = [];
  const dependencies = {
    courseDate: (value = new ObservationClock()) => courseDate(value),
    Date: ObservationClock,
    object: (value) => value,
    text: (value) => value || "",
    number: (value) => value,
    fail: (_code, message) => { throw new Error(message); },
    lockStaffingResource: async () => {},
    actorId: (actor) => actor.id,
    canManageOpportunity: async () => false,
    findOpportunity: async () => ({ id: "posting" }),
    isGlobalAdmin: () => false,
    uid: () => "work-record",
    event: async () => {},
    publicRecord: (value) => value,
  };
  const recordWorkload = new Function(
    ...Object.keys(dependencies),
    compile(declaration.getText(parsed).replace(/^export\s+/, "")) + "\nreturn recordWorkload;",
  )(...Object.values(dependencies));
  const db = { collection: (name) => ({
    findOne: async () => name === "staffingAppointments" ? appointment : null,
    find: () => ({ toArray: async () => [] }),
    insertOne: async (record) => { records.push(record); },
  }) };
  const actor = { id: "worker", email: "alex@example.com" };
  const record = (date) => recordWorkload(db, {}, actor, { appointmentId: appointment.id, date, kind: "office_hours", hours: 0.5 });
  return { appointment, records, record };
}

test("the API accepts a late-evening same-day appointment and rejects dates outside its course-day boundaries", async () => {
  const service = workloadService();
  const result = await service.record("2026-11-07");
  assert.equal(result.record.date, "2026-11-07");
  assert.equal(service.records.length, 1);
  for (const invalid of ["2026-11-06", "2026-11-08", "2026-11-13", "2026-02-31"])
    await assert.rejects(service.record(invalid), /within the appointment/);
  assert.equal(service.records.length, 1);
  service.appointment.startDate = new Date("2026-11-05T05:00:00Z");
  const earlier = await service.record("2026-11-06");
  assert.equal(earlier.record.date, "2026-11-06");
  assert.equal(service.records[0].date, "2026-11-07");
});
