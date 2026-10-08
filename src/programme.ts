// Today's programme as the kiosk itself received it (content/csessions), read from the recorded API calls.
// Tests use it to pick a film and a show time that is still ahead, instead of hard-coding them.
import type { RecordedCall } from './api-recorder';

export interface Show {
  film: string;
  experience: string;
  // "16:45", as shown on the kiosk.
  time: string;
  startsAt: Date;
  seatsAvailable: number;
  /** Film rating, e.g. "PG15" or "R18". */
  rating: string;
  /** Films with a rating description (R18, T13+, PG) show an age notice on the seat screen and may ask to confirm it. */
  ageNotice: boolean;
}

interface DaySession {
  movie: { title: string; rating?: string; ratingDescription?: string };
  experienceSessions: { experience: string; shows: { showTime: string; showtime: string; seatsAvailable: number; soldoutStatus: number; allowTicketSales: string }[] }[];
}

/** All bookable shows from the latest programme call the kiosk made. */
export function showsFromCalls(calls: RecordedCall[]): Show[] {
  const programme = [...calls].reverse().find((c) => c.path.startsWith('content/csessions') && c.status === 200
    && (c.responseBody as { output?: { daySessions?: unknown[] } })?.output?.daySessions?.length);
  if (!programme) return [];
  const daySessions = (programme.responseBody as { output: { daySessions: DaySession[] } }).output.daySessions;
  return daySessions.flatMap((day) => day.experienceSessions.flatMap((exp) => exp.shows
    .filter((s) => s.soldoutStatus === 0 && s.allowTicketSales === 'true')
    .map((s) => ({ film: day.movie.title, experience: exp.experience, time: s.showTime, startsAt: new Date(s.showtime), seatsAvailable: s.seatsAvailable,
      rating: day.movie.rating ?? '',
      // Build New15 shows the 18+ notice for R18 films even when UAT sends no rating description.
      ageNotice: Boolean(day.movie.ratingDescription) || /18/.test(day.movie.rating ?? '') }))));
}

/**
 * The first show that starts at least `minutesAhead` (default 60) from now and has at least `minSeats` free seats.
 * Films with an age notice (R18, T13+, PG) are left out unless `allowAgeNotice`: on build New14 their seat screen
 * shows the notice and Proceed did not go on to the seat map. Shows starting within the hour were also not opened
 * any more (4 Oct 2026, a 15:30 show tapped at 14:59).
 */
export function pickShow(shows: Show[], options: { minutesAhead?: number; minSeats?: number; experience?: string; allowAgeNotice?: boolean } = {}): Show {
  const earliest = Date.now() + (options.minutesAhead ?? 60) * 60_000;
  const show = shows
    .filter((s) => s.startsAt.getTime() >= earliest && s.seatsAvailable >= (options.minSeats ?? 10))
    .filter((s) => !options.experience || s.experience === options.experience)
    .filter((s) => options.allowAgeNotice || !s.ageNotice)
    // Smaller halls first (up to 200 free seats), then the earliest: on build New15 every search on a big seat map
    // (250+ seats) takes seconds, enough for "Are you still there?" to cover the map.
    .sort((a, b) => Number(a.seatsAvailable > 200) - Number(b.seatsAvailable > 200) || a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (!show) throw new Error('No show later today with free seats. The kiosk only sells today\'s shows; run the test earlier in the day.');
  return show;
}
