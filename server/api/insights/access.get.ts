import { defineEventHandler, setHeader } from "h3";
import { requireUser } from "../../utils/auth";
import { courseInsightsAccess } from "../../utils/course-insights";

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  setHeader(event, "Cache-Control", "private, no-store");
  return courseInsightsAccess(user);
});
