const SESSION_TITLE_DATE_LOCALE = "en-PH";
const SESSION_TITLE_TIME_ZONE = "Asia/Manila";

export function formatFirstChatSessionTitle(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const dateLabel = parsed.toLocaleDateString(SESSION_TITLE_DATE_LOCALE, {
    timeZone: SESSION_TITLE_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeLabel = parsed.toLocaleTimeString(SESSION_TITLE_DATE_LOCALE, {
    timeZone: SESSION_TITLE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${dateLabel} ${timeLabel}`;
}
