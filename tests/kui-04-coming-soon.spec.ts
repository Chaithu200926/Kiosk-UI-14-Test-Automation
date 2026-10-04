// KUI-04: COMING SOON lists the upcoming films under their opening dates, with details.
import { test, expect } from '../src/fixtures';

test('KUI-04 Coming soon: films show opening dates and details, not on sale yet', async ({ kiosk }) => {
  const films = await kiosk.step('Open COMING SOON: posters grouped under their opening dates', async () => {
    await kiosk.tap('COMING SOON', { settleMs: 2000 });
    await kiosk.waitForText('Coming Soon');
    // Build New14: date groups "ComingDateGroup { Heading = 07 Oct 2026, ... }" holding poster tiles
    // "ComingFilmView { Coming = ComingFilm { Film = Film { Id = ..., Title = <title>, ...". Titles are only in these names.
    const xml = await kiosk.app.getPageSource();
    const list: { title: string; opens: string }[] = [];
    let heading = '';
    for (const m of xml.matchAll(/Name="(?:ComingDateGroup \{ Heading = ([^,]+),|ComingFilmView \{ Coming = ComingFilm \{ Film = Film \{ Id = \w+, Title = ([^,]+),)/g)) {
      if (m[1]) heading = m[1];
      else list.push({ title: m[2].replace(/&amp;/g, '&'), opens: heading });
    }
    expect(list.length, 'Coming-soon films').toBeGreaterThan(0);
    for (const f of list) {
      expect.soft(await kiosk.hasText(f.opens), `Date heading "${f.opens}" shown`).toBe(true);
      expect.soft(new Date(f.opens).getTime(), `${f.title}: "${f.opens}" is a future date`).toBeGreaterThan(Date.now() - 24 * 3600_000);
    }
    return list;
  });

  await kiosk.step('The kiosk loaded the list from content/comingsoon', async () => {
    const call = await kiosk.waitForApiCall('content/comingsoon');
    expect(call.status).toBe(200);
    expect((call.responseBody as { code: number }).code).toBe(10001);
  });

  const first = films![0];
  await kiosk.step(`Open "${first.title}": details and "Tickets are not on sale yet."`, async () => {
    await kiosk.app.$(`//DataItem[contains(@Name, "Title = ${first.title},")]`).click();
    await kiosk.waitForText('Tickets are not on sale yet.');
    await kiosk.waitForText(first.title);
    const texts = await kiosk.texts();
    expect.soft(texts.some((t) => /\|\s+\d+ hr( \d+ min)?$/.test(t)), 'Language | genre | run time').toBe(true);
    // The list shows "07 Oct 2026", the details "Opens 7 October 2026".
    const opens = new Date(first.opens).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    expect.soft(texts, 'Opening date in the details').toContain(`Opens ${opens}`);
    expect.soft(texts.some((t) => t.length > 40), 'Synopsis').toBe(true);
  });

  await kiosk.step('Close the details, then HOME', async () => {
    await kiosk.tap('Close', { settleMs: 1000 });
    // Build New14 keeps the closed details in the page (off screen), so check the text is no longer visible.
    await expect.poll(async () => (await kiosk.texts()).includes('Tickets are not on sale yet.'), { message: 'Details closed', timeout: 5_000 }).toBe(false);
    await kiosk.tap('HOME', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
