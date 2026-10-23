import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, Location } from '@hebcal/core';
import { DateTime } from 'luxon';

export const lessonZone = 'Asia/Jerusalem';
export type CalendarLocation = { name: string; latitude: number; longitude: number };
export type WeeklyWindow = { day_of_week: number; start_time: string; end_time: string; is_active: boolean };
export type BusyLesson = { requested_start_at: string | null; requested_end_at: string | null };
export const defaultWeeklyWindows = () => Array.from({ length: 5 }, (_, day_of_week) => ({ day_of_week, start_time: '09:00:00', end_time: '21:00:00', is_active: true }));

export function buildLessonCalendar(input: { slots: WeeklyWindow[]; customized: boolean; location?: CalendarLocation | null; busy: BusyLesson[]; duration: number; days?: number; now?: DateTime }) {
  const now = (input.now ?? DateTime.now()).setZone(lessonZone);
  const first = now.startOf('day');
  const days = input.days ?? 60;
  const suppliedLocation = input.location && Number.isFinite(input.location.latitude) && Number.isFinite(input.location.longitude) ? input.location : null;
  const knownCityName = suppliedLocation?.name === 'ירושלים' ? 'Jerusalem' : suppliedLocation?.name === 'חיפה' ? 'Haifa' : suppliedLocation?.name === 'זכרון יעקב' ? "Zikhron Ya'akov" : suppliedLocation?.name;
  const location = suppliedLocation ? new Location(suppliedLocation.latitude, suppliedLocation.longitude, true, lessonZone, knownCityName, 'IL') : Location.lookup('Jerusalem')!;
  const events = HebrewCalendar.calendar({ start: first.minus({ days: 2 }).toJSDate(), end: first.plus({ days: days + 2 }).toJSDate(), location, candlelighting: true, noHolidays: true, havdalahDeg: 8.5 });
  const entries = events.filter((event): event is CandleLightingEvent => event instanceof CandleLightingEvent && DateTime.fromJSDate(event.eventTime, { zone: lessonZone }).weekday === 5);
  const exits = events.filter((event): event is HavdalahEvent => event instanceof HavdalahEvent && DateTime.fromJSDate(event.eventTime, { zone: lessonZone }).weekday === 6);
  const shabbat = entries.map((entry) => {
    const start = entry.eventTime.getTime();
    const end = exits.find((exit) => exit.eventTime.getTime() > start && exit.eventTime.getTime() < start + 2 * 86400000)?.eventTime.getTime() ?? start + 2 * 86400000;
    return { start, end };
  });
  const busy = input.busy.filter((lesson) => lesson.requested_start_at && lesson.requested_end_at)
    .map((lesson) => ({ start: Date.parse(lesson.requested_start_at!), end: Date.parse(lesson.requested_end_at!) }));
  const windows = input.customized ? input.slots : defaultWeeklyWindows();
  return {
    timezone: lessonZone, locationName: suppliedLocation?.name ?? 'ירושלים', locationFallback: !suppliedLocation,
    usesDefault: !input.customized, duration: input.duration,
    shabbat: shabbat.map((interval) => ({ startAt: new Date(interval.start).toISOString(), endAt: new Date(interval.end).toISOString() })),
    days: Array.from({ length: days }, (_, index) => {
      const date = first.plus({ days: index });
      const starts = new Map<string, { time: string; startAt: string; endAt: string }>();
      for (const window of windows.filter((slot) => slot.is_active && slot.day_of_week === date.weekday % 7)) {
        const start = DateTime.fromISO(`${date.toISODate()}T${window.start_time}`, { zone: lessonZone });
        const end = DateTime.fromISO(`${date.toISODate()}T${window.end_time}`, { zone: lessonZone });
        if (!start.isValid || !end.isValid || end <= start) continue;
        for (let cursor = start; cursor.plus({ minutes: input.duration }) <= end; cursor = cursor.plus({ minutes: 30 })) {
          const finish = cursor.plus({ minutes: input.duration });
          if (cursor <= now || cursor.getPossibleOffsets().length !== 1) continue;
          if ([...shabbat, ...busy].some((blocked) => cursor.toMillis() < blocked.end && finish.toMillis() > blocked.start)) continue;
          starts.set(cursor.toISO()!, { time: cursor.toFormat('HH:mm'), startAt: cursor.toUTC().toISO()!, endAt: finish.toUTC().toISO()! });
        }
      }
      return { date: date.toISODate()!, label: date.setLocale('he').toFormat('cccc dd/MM/yyyy'), times: [...starts.values()].sort((left, right) => left.startAt.localeCompare(right.startAt)) };
    }),
  };
}