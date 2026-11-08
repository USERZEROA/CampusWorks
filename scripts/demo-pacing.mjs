const timeline = [
  ["Open the shared recruitment cycle", "admin", 2],
  ["Define the course position", "instructor", 7],
  ["Set qualifications and publish for approval", "instructor", 6],
  ["Approve the course opening", "admin", 2],
  ["Requirement Draft Assistance", "instructor", 22, "ai"],
  ["Discover the opportunity", "applicant", 3],
  ["Answer the qualification questions", "applicant", 9, "application"],
  ["Attach a CV and submit", "applicant", 5, "document"],
  ["Apply to another course as well", "applicant", 2],
  ["A second instructor reviews the same applicant", "peer", 3],
  ["Review Alex for CS201", "instructor", 7, "review"],
  ["Qualification Summary Assistance", "instructor", 22, "ai"],
  ["Candidate Review Assistance", "instructor", 22, "ai"],
  ["Shortlist and issue the offer", "instructor", 6, "decision"],
  ["The other instructor sees availability update", "peer", 5],
  ["Candidate Review Assistance", "peer", 26, "comparison"],
  ["Accept the CS201 offer", "applicant", 6, "decision"],
  ["Record the appointment clearance", "admin", 7, "clearance"],
  ["Alex becomes the appointed course TA", "applicant", 11, "activation"],
  ["Start the office-hours shift", "applicant", 2],
  ["The existing TA coordinates the session", "mentor", 5, "document"],
  ["A student enrolls in the course", "learner", 2],
  ["Ask for help through the live queue", "learner", 4],
  ["Alex claims Sam’s request", "applicant", 5],
  ["The student sees who is helping", "learner", 3],
  ["Complete the help session", "applicant", 2],
  ["Give feedback on the support", "learner", 7, "review"],
  ["Record work beyond queue timing", "applicant", 5, "document"],
  ["Review course operations and feedback", "instructor", 9, "operations"],
  ["Close the course support queue", "mentor", 2],
  ["Return to the TA page before closeout", "applicant", 2],
  ["End the appointment with a reason", "instructor", 5],
  ["TA access disappears automatically", "applicant", 6, "decision"],
  ["See the evidence for the next cycle", "instructor", 11, "course"],
  ["Course Suggestions", "instructor", 24, "course-ai"],
  ["Compare department demand and support", "admin", 15, "department"],
  ["Archive the completed opening", "instructor", 2],
  ["One account, a complete lifecycle", "applicant", 4],
];

const minimumView = {
  ai: 15000,
  comparison: 18000,
  "course-ai": 18000,
  application: 7000,
  document: 4000,
  review: 6000,
  decision: 3500,
  clearance: 5500,
  activation: 8000,
  operations: 8000,
  course: 9000,
  department: 12000,
};
const aiCategories = new Set(["ai", "comparison", "course-ai"]);

export function createDemoPacing({ pace = "normal", withAi = true } = {}) {
  if (!["fast", "normal", "detailed"].includes(pace))
    throw new Error("Use fast, normal or detailed pacing.");
  const targetMs = pace === "fast" ? 0 : pace === "normal" ? 300000 : 480000;
  const scale = pace === "detailed" ? 1.6 : 1;
  const rows = timeline.filter((row) => withAi || !aiCategories.has(row[3]));
  const totalWeight = rows.reduce((sum, row) => sum + row[2], 0);
  let allocated = 0;
  const steps = rows.map(([title, actor, weight, category], index) => {
    const durationMs = index === rows.length - 1
      ? targetMs - allocated
      : Math.floor(targetMs * weight / totalWeight);
    allocated += durationMs;
    return Object.freeze({
      title, actor, category: category || "transition",
      ...(pace === "fast"
        ? { holdMs: 150, minViewMs: 0 }
        : { durationMs, minViewMs: (minimumView[category] || 800) * scale }),
    });
  });
  return Object.freeze({
    pace, targetMs, beforeMs: pace === "fast" ? 0 : 350,
    steps: Object.freeze(steps),
    forStep({ index, title, actor }) {
      const planned = steps[index - 1];
      if (!planned || planned.title !== title || planned.actor !== actor)
        throw new Error("The lifecycle step and presentation timing plan differ.");
      const { durationMs, minViewMs, holdMs } = planned;
      return { durationMs, minViewMs, holdMs };
    },
  });
}
