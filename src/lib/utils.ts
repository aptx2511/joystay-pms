import { format, parseISO, differenceInDays, isValid } from "date-fns";

/** Format a date string or Date to a human-readable string */
export function formatDate(date: string | Date, fmt = "dd MMM yyyy"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "—";
  return format(d, fmt);
}

/** Number of nights between check-in and check-out */
export function nightCount(checkIn: string | Date, checkOut: string | Date): number {
  const ci = typeof checkIn === "string" ? parseISO(checkIn) : checkIn;
  const co = typeof checkOut === "string" ? parseISO(checkOut) : checkOut;
  return differenceInDays(co, ci);
}

/** Format a price (Vietnamese Dong or generic) */
export function formatPrice(price: number | null | undefined, currency = "VND"): string {
  if (price == null) return "—";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(price);
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Generate a simple iCal VEVENT string */
export function buildICalEvent(params: {
  uid: string;
  summary: string;
  dtStart: Date;
  dtEnd: Date;
  description?: string;
}): string {
  const fmt = (d: Date) => format(d, "yyyyMMdd");
  return [
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTART;VALUE=DATE:${fmt(params.dtStart)}`,
    `DTEND;VALUE=DATE:${fmt(params.dtEnd)}`,
    `SUMMARY:${params.summary}`,
    params.description ? `DESCRIPTION:${params.description}` : "",
    `STATUS:CONFIRMED`,
    "END:VEVENT",
  ]
    .filter(Boolean)
    .join("\r\n");
}

/** Wrap VEVENT entries in a full iCal calendar string */
export function buildICalFeed(calName: string, events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Joystay PMS//EN",
    `X-WR-CALNAME:${calName}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
