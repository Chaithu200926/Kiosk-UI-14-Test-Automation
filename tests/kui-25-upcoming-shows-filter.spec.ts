// KUI-25: the experience filter under UPCOMING SHOWS on the home screen (new in build New14): each experience chip
// (e.g. 4DX, Dolby, VIP) shows only that experience's next shows, and "All" shows them all again.
import { test, expect } from '../src/fixtures';
import type { Kiosk } from '../src/kiosk';

const CHIP = '//DataItem[@Name="Cinescape.Kiosk.Presentation.Screens.ExperienceChoice"]';

/** Experiences of the upcoming show times on the home screen, e.g. ["4DX", "DOLBY", "Standard"]. */
async function upcomingExperiences(kiosk: Kiosk) {
  const xml = await kiosk.app.getPageSource();
  return [...xml.matchAll(/Name="UpcomingTime \{ Time = [\d:]+, Experience = ([^}]+?) \}"/g)].map((m) => m[1]);
}

test('KUI-25 Upcoming shows: the experience filter shows only that experience', async ({ kiosk }) => {
  const [chips, all] = (await kiosk.step('UPCOMING SHOWS: "All" is chosen and the experience chips are shown', async () => {
    const count = (await kiosk.app.$$(CHIP).getElements()).length;
    expect(count, 'Filter chips (All + experiences)').toBeGreaterThan(1);
    expect(await kiosk.hasButton('All'), '"All" chip').toBe(true);
    const shown = await upcomingExperiences(kiosk);
    expect(shown.length, 'Upcoming show times').toBeGreaterThan(0);
    return [count, new Set(shown)] as const;
  }))!;

  const seen: string[] = [];
  for (let chip = 2; chip <= chips; chip++) {
    await kiosk.step(`Chip ${chip}: only one experience is listed`, async () => {
      await kiosk.app.$(`${CHIP}[${chip}]//Button`).click();
      await new Promise((r) => setTimeout(r, 2000));
      const shown = await upcomingExperiences(kiosk);
      const kinds = [...new Set(shown)];
      // A chip with no shows left today may show an empty list; record it rather than fail.
      if (!shown.length) {
        test.info().annotations.push({ type: 'note', description: `Chip ${chip}: no upcoming shows listed` });
        return;
      }
      expect(kinds, `Chip ${chip} lists a single experience`).toHaveLength(1);
      expect(seen, 'A different experience from the other chips').not.toContain(kinds[0]);
      seen.push(kinds[0]);
    });
  }
  test.info().annotations.push({ type: 'experience chips', description: `All, ${seen.join(', ')}` });

  await kiosk.step('"All" shows every experience again', async () => {
    await kiosk.tap('All', { settleMs: 2000 });
    expect(new Set(await upcomingExperiences(kiosk)), 'Same experiences as at the start').toEqual(all);
  });
});
