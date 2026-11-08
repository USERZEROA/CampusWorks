import { defineEventHandler, getQuery, setHeader } from "h3";
import { requireUser } from "../../utils/auth";
import { readCourseInsights } from "../../utils/course-insights";

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  setHeader(event, "Cache-Control", "private, no-store");
  return readCourseInsights(user, getQuery(event));
});
