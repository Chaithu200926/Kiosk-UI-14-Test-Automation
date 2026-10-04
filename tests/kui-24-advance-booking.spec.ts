// KUI-24: ADVANCE BOOKING (new in build New14) lists the films on advance booking; a film shows its details and
// show times, and a show time opens the seat category screen. Nothing is reserved: the test cancels there.
import { test, expect } from '../src/fixtures';
import { SEAT_CATEGORY } from '../src/flows';
import type { Kiosk } from '../src/kiosk';

const NONE = 'No films are on advance booking right now.';
const NO_SHOWS = 'This film has no shows on sale at this cinema yet.';

/** First text inside each list item of a kind, in screen order (e.g. the film titles or the show times). */
async function itemTexts(kiosk: Kiosk, itemType: string) {
  const xml = await kiosk.app.getPageSource();
  return xml.split(`Screens.${itemType}`).slice(1)
    .map((block) => block.match(/<Text\b[^>]*\bName="([^"]+)"/)?.[1] ?? '')
    .filter(Boolean);
}

test('KUI-24 Advance booking: films, details and show times; a show opens the seat category screen', async ({ kiosk }) => {
  const films = (await kiosk.step('Open ADVANCE BOOKING: the films on advance booking are listed', async () => {
    await kiosk.tap('ADVANCE BOOKING', { settleMs: 2500 });
    await kiosk.waitForText('Advance Booking');
    expect.soft(await kiosk.hasButton('HOME'), 'HOME button').toBe(true);
    // Each film is a DataItem "Film { Id = ..., Title = <title>, ... }".
    const xml = await kiosk.app.getPageSource();
    const titles = [...xml.matchAll(/Name="Film \{ Id = \w+, Title = ([^,]+),/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (!titles.length) expect(await kiosk.hasText(NONE), `No films, so "${NONE}"`).toBe(true);
    test.info().annotations.push({ type: 'advance booking', description: titles.length ? titles.join(', ') : NONE });
    return titles;
  }))!;
  test.skip(!films.length, `${NONE} (nothing more to check today)`);

  const film = films[0];
  const times = (await kiosk.step(`Open "${film}": details and its show times by experience`, async () => {
    await kiosk.tap(film, { settleMs: 2500 });
    await kiosk.waitForText(film);
    const texts = await kiosk.texts();
    expect.soft(texts.some((t) => /\|\s+\d+ hr( \d+ min)?$/.test(t)), 'Language | genre | run time').toBe(true);
    expect.soft(await kiosk.hasButton('MOVIES'), 'MOVIES button').toBe(true);
    const shown = await itemTexts(kiosk, 'ShowtimeChoice');
    if (!shown.length) expect(await kiosk.hasText(NO_SHOWS), `No show times, so "${NO_SHOWS}"`).toBe(true);
    else expect((await kiosk.app.getPageSource()).includes('ExperienceRow { Experience = '), 'Show times are grouped by experience').toBe(true);
    test.info().annotations.push({ type: 'show times', description: `${film}: ${shown.join(', ') || NO_SHOWS}` });
    return shown;
  }))!;
  test.skip(!times.length, `${film}: ${NO_SHOWS}`);

  await kiosk.step(`Choose the ${times[0]} show: "${SEAT_CATEGORY}" for that film, date and time`, async () => {
    await kiosk.tap(times[0], { settleMs: 2500 });
    await kiosk.waitForText(SEAT_CATEGORY);
    expect(await kiosk.hasText(film), 'Film in the header').toBe(true);
    expect(await kiosk.hasTextContaining(times[0]), 'Date and time in the header').toBe(true);
  });

  await kiosk.step('Cancel returns to the home screen (nothing was reserved)', async () => {
    await kiosk.tap('Cancel', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
