export const courseTimeZone = "America/New_York" as const;

const courseDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: courseTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function courseDate(value: Date | number | string = new Date()): string {
  const parts = Object.fromEntries(
    courseDateFormat
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
