// KUI-24: ADVANCE BOOKING (new in build New14) lists the films on advance booking; opening a film first warns that
// it is an advance date (build New17), then shows its details and show times, and a show time opens the seat
// category screen. Nothing is reserved: the test cancels there.
import { test, expect } from '../src/fixtures';
import { SEAT_CATEGORY } from '../src/flows';
import type { Kiosk } from '../src/kiosk';

const NONE = 'No films are on advance booking right now.';
const NO_SHOWS = 'This film has no shows on sale at this cinema yet.';
const ADVANCE_NOTICE = 'You are booking for an advance date.';
const GO_BACK = 'Cancel & go back';

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
    // The heading is the tile's text in capitals (build New17; "Advance Booking" before).
    await expect.poll(async () => (await kiosk.texts()).filter((t) => t === 'ADVANCE BOOKING').length, { timeout: 20_000 })
      .toBeGreaterThan(0);
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
  // Build New17 warns as soon as an advance film opens: "You are booking for an advance date." with
  // "Cancel & go back" (back to the film list) and OK (on to the film's show times).
  await kiosk.step(`Open "${film}": the kiosk warns it is an advance date; "Cancel & go back" returns to the films`, async () => {
    await kiosk.tap(film, { settleMs: 2500 });
    await kiosk.waitForText(ADVANCE_NOTICE);
    expect.soft(await kiosk.hasButton('OK'), 'OK button').toBe(true);
    await kiosk.tap(GO_BACK, { settleMs: 2000 });
    await expect.poll(() => kiosk.hasText(ADVANCE_NOTICE), { timeout: 10_000 }).toBe(false);
    const xml = await kiosk.app.getPageSource();
    expect(xml, 'Back on the film list').toContain(`Title = ${film.replace(/&/g, '&amp;')},`);
    expect(xml, 'No show times open').not.toContain('Screens.ShowtimeChoice');
  });

  const times = (await kiosk.step(`Open "${film}" again and tap OK: details and its show times by experience`, async () => {
    await kiosk.tap(film, { settleMs: 2500 });
    await kiosk.waitForText(ADVANCE_NOTICE);
    await kiosk.tap('OK', { settleMs: 2000 });
    await expect.poll(() => kiosk.hasText(ADVANCE_NOTICE), { timeout: 10_000 }).toBe(false);
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
    await kiosk.tapUntil(times[0], SEAT_CATEGORY, { settleMs: 2500 });
    expect(await kiosk.hasText(film), 'Film in the header').toBe(true);
    expect(await kiosk.hasTextContaining(times[0]), 'Date and time in the header').toBe(true);
  });

  await kiosk.step('Cancel returns to the home screen (nothing was reserved)', async () => {
    await kiosk.tap('Cancel', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
