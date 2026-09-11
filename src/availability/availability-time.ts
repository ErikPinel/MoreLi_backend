import { AvailabilitySlot } from './availability.repository.js';

const WEEKDAYS = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

export function isAvailableAt(
  slots: AvailabilitySlot[],
  instant: Date,
): boolean {
  return slots.some((slot) => slotContainsInstant(slot, instant));
}

function slotContainsInstant(slot: AvailabilitySlot, instant: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: slot.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const day = WEEKDAYS.get(value('weekday'));
  const time = `${value('hour')}:${value('minute')}:${value('second')}`;
  return (
    day === slot.day_of_week &&
    time >= slot.start_time &&
    time < slot.end_time
  );
}