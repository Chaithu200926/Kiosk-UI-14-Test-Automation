// KUI-03: BUY TICKETS (films showing now) lists today's films and each film shows the show times from today's programme.
import { test, expect } from '../src/fixtures';
import { pickShow, showsFromCalls } from '../src/programme';

test('KUI-03 Films and show times match today\'s programme', async ({ kiosk }) => {
  await kiosk.waitForApiCall('content/csessions');
  const programme = showsFromCalls(kiosk.apiCalls());
  const filmsToday = new Set(programme.map((s) => s.film));

  await kiosk.step('Open BUY TICKETS (films showing now)', async () => {
    await kiosk.tap('BUY TICKETS', { settleMs: 1500 });
  });

  // Returns a film on the first screen (no scrolling) that still has a show later today.
  const show = (await kiosk.step('Every film tile on screen is in today\'s programme', async () => {
    const texts = await kiosk.texts();
    const tiles = texts.filter((t) => filmsToday.has(t));
    expect(tiles.length, 'Film tiles shown').toBeGreaterThan(0);
    // Each tile shows "Language | Genre" under the title.
    expect.soft(texts.some((t) => /^[A-Za-z]+ \| .+/.test(t)), 'Language | genre line on the tiles').toBe(true);
    const onScreen = new Set((await kiosk.visibleTexts()).map((t) => t.name));
    return pickShow(programme.filter((s) => onScreen.has(s.film)));
  }))!;

  await kiosk.step(`Open "${show.film}" and check its details`, async () => {
    await kiosk.tap(show.film, { settleMs: 1500 });
    await kiosk.waitForText(show.film);
    const texts = await kiosk.texts();
    // "English  |  Thriller  |  1 hr 26 min" and a synopsis sentence.
    expect.soft(texts.some((t) => /\|\s+\d+ hr( \d+ min)?$/.test(t)), 'Language | genre | run time').toBe(true);
    expect.soft(texts.some((t) => t.length > 40 && /\.\s*$/.test(t)), 'Synopsis').toBe(true);
    expect.soft(await kiosk.hasButton('HOME'), 'HOME button').toBe(true);
    expect.soft(await kiosk.hasButton('MOVIES'), 'MOVIES button').toBe(true);
  });

  await kiosk.step('Show times on screen match the programme (today only, no date picker)', async () => {
    const texts = new Set(await kiosk.texts());
    const filmShows = programme.filter((s) => s.film === show.film);
    // Every show that is still at least 15 minutes away must be offered.
    const upcoming = filmShows.filter((s) => s.startsAt.getTime() > Date.now() + 15 * 60_000);
    for (const s of upcoming) expect.soft(texts.has(s.time), `Show time ${s.time} (${s.experience})`).toBe(true);
    // And each experience (e.g. Standard, VIP) has its own row of show times.
    const source = await kiosk.app.getPageSource();
    for (const exp of new Set(upcoming.map((s) => s.experience))) {
      expect.soft(source.includes(`ExperienceRow { Experience = ${exp},`), `Experience row ${exp}`).toBe(true);
    }
  });

  await kiosk.step('MOVIES returns to the film list', async () => {
    await kiosk.tap('MOVIES', { settleMs: 1500 });
    await kiosk.waitForText(show.film);
    expect(await kiosk.hasButton('FILTER'), 'FILTER button on the film list').toBe(true);
  });
});
