// Date and time utility functions

const getNthWeekdayOfMonthUtc = (year: number, month: number, weekday: number, nth: number) => {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstWeekdayOffset = (weekday - firstOfMonth.getUTCDay() + 7) % 7;
  const day = 1 + firstWeekdayOffset + (nth - 1) * 7;
  return new Date(Date.UTC(year, month, day));
};

export const getEasternOffsetMinutes = (date: Date) => {
  const year = date.getUTCFullYear();
  const startDst = getNthWeekdayOfMonthUtc(year, 2, 0, 2); // Second Sunday in March
  startDst.setUTCHours(7, 0, 0, 0); // 2 AM ET -> 7 AM UTC during standard time
  const endDst = getNthWeekdayOfMonthUtc(year, 10, 0, 1); // First Sunday in November
  endDst.setUTCHours(6, 0, 0, 0); // 2 AM ET -> 6 AM UTC during daylight time
  const isDst = date >= startDst && date < endDst;
  return isDst ? -240 : -300; // minutes offset from UTC
};

export const parseBallDontLieTipoff = (game: any): Date | null => {
  if (!game) return null;
  const iso = String(game?.date || '');
  if (!iso) return null;
  const status = String(game?.status || '');
  const datePart = iso.split('T')[0];
  if (!datePart) return null;

  const timeMatch = status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  if (!timeMatch) {
    const fallback = new Date(iso);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  const baseDate = new Date(iso);
  const offsetMinutes = getEasternOffsetMinutes(baseDate);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes <= 0 ? '-' : '+';
  const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

  const zonedIso = `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
  const parsed = new Date(zonedIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

