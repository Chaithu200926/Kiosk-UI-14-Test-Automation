// KUI-15: a kiosk left untouched first asks "Are you still there?", then returns to the home screen, and seats held
// by an abandoned booking are released. (The prompt is new in build New14.)
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, expectReservation, openUpcomingShow, pickFreeSeats } from '../src/flows';
import type { Kiosk } from '../src/kiosk';

const PROMPT = 'Are you still there?';

/** Waits (without touching the kiosk) until the idle prompt shows; returns the seconds it took. */
async function waitForPrompt(kiosk: Kiosk, maxSeconds: number) {
  const started = Date.now();
  while (Date.now() - started < maxSeconds * 1000) {
    if (await kiosk.hasText(PROMPT)) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`"${PROMPT}" did not appear within ${maxSeconds} s of inactivity`);
}

/** Waits (without touching the kiosk) until the home screen is back; returns the seconds it took. */
async function waitUntilHome(kiosk: Kiosk, maxSeconds: number) {
  const started = Date.now();
  while (Date.now() - started < maxSeconds * 1000) {
    if (await kiosk.hasText('UPCOMING SHOWS')) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`The kiosk did not return to the home screen within ${maxSeconds} s of inactivity`);
}

test('KUI-15 Idle timeout: the kiosk returns home and releases held seats', async ({ kiosk }) => {
  test.setTimeout(900_000);

  await kiosk.step('Open BUY TICKETS, then leave the kiosk untouched', async () => {
    await kiosk.tap('BUY TICKETS', { settleMs: 1000 });
    await kiosk.waitForText('FILTER');
  });

  await kiosk.step(`"${PROMPT}" appears with a countdown and YES, I'M HERE`, async () => {
    const seconds = await waitForPrompt(kiosk, 180);
    test.info().annotations.push({ type: 'idle timeout', description: `Film list → "${PROMPT}" after about ${seconds} s` });
    expect(seconds, 'Seconds until the prompt').toBeGreaterThanOrEqual(10);
    expect.soft(await kiosk.hasTextContaining('Otherwise the kiosk starts again in'), 'Countdown message').toBe(true);
    expect(await kiosk.hasButton("YES, I'M HERE"), "YES, I'M HERE button").toBe(true);
  });

  await kiosk.step("YES, I'M HERE keeps the customer on the film list", async () => {
    await kiosk.tap("YES, I'M HERE", { settleMs: 1500 });
    expect(await kiosk.hasText(PROMPT), 'Prompt closed').toBe(false);
    expect(await kiosk.hasText('FILTER'), 'Still on the film list').toBe(true);
  });

  await kiosk.step('Left untouched again: the prompt comes back and the kiosk returns home by itself', async () => {
    await waitForPrompt(kiosk, 180);
    const seconds = await waitUntilHome(kiosk, 120);
    test.info().annotations.push({ type: 'idle timeout', description: `"${PROMPT}" → home after about ${seconds} s` });
  });

  const show = await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);
  const since = Date.now();
  const [seat] = (await kiosk.step('Choose a free seat and proceed (the kiosk reserves it), then leave the kiosk', async () => {
    const seats = await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    return seats;
  }))!;
  const reservation = await expectReservation(kiosk, since, [seat]);

  await kiosk.step('Abandoned booking: the kiosk returns home by itself', async () => {
    // The booking timer on the checkout screen is about 7 minutes; allow 8.
    const seconds = await waitUntilHome(kiosk, 480);
    test.info().annotations.push({ type: 'idle timeout', description: `Food screen with a held seat → home after about ${seconds} s` });
  });

  await kiosk.step(`The held seat ${seat} was released (content/trans/cancel)`, async () => {
    const cancel = kiosk.apiCalls().filter((c) => c.path.startsWith('content/trans/cancel')
      && String((c.requestBody as { transid?: unknown })?.transid) === String(reservation.transid)).pop();
    expect(cancel, `A cancel call for transaction ${reservation.transid}`).toBeTruthy();
    expect((cancel!.responseBody as { code: number }).code, 'cancel response code').toBe(10001);
  });
});
