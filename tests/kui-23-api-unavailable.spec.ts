// KUI-23: when the UAT API is down the kiosk shows friendly messages, does not crash, and recovers.
// The outage is simulated by the API recorder (HTTP 503 for every kiosk API call); the kiosk settings are not changed.
import { test, expect } from '../src/fixtures';

test('KUI-23 API unavailable: friendly messages, no crash, recovers when the API is back', async ({ kiosk }) => {
  const outageStart = Date.now();
  await kiosk.step('Simulate the API being down (every API call answers HTTP 503)', async () => {
    kiosk.apiOutage(true);
  });

  await kiosk.step('BUY TICKETS: "This is not available right now" with a Try again button', async () => {
    await kiosk.tap('BUY TICKETS', { settleMs: 3000 });
    // The message itself is drawn but not exposed to UI Automation (see the screenshot); the button is.
    await kiosk.button('Try again', 1, 15_000);
    expect(await kiosk.hasText('FILTER'), 'Still on the film list screen (no crash)').toBe(true);
    const films = (await kiosk.texts()).filter((t) => /^[A-Za-z]+ \| .+/.test(t));
    expect(films.length, 'No film tiles while the API is down').toBe(0);
  });

  await kiosk.step('The kiosk\'s calls really failed with 503 (simulated outage)', async () => {
    const failed = kiosk.apiCalls().filter((c) => c.time >= outageStart && c.status === 503);
    expect(failed.length, 'API calls answered 503').toBeGreaterThan(0);
  });

  await kiosk.step('API back: Try again loads the film list', async () => {
    kiosk.apiOutage(false);
    await kiosk.tap('Try again', { settleMs: 3000 });
    await kiosk.waitForText('FILTER');
    expect(await kiosk.hasButton('Try again'), 'Try again gone').toBe(false);
    const films = (await kiosk.texts()).filter((t) => /^[A-Za-z]+ \| .+/.test(t));
    expect(films.length, 'Film tiles after recovery').toBeGreaterThan(0);
  });

  await kiosk.step('API down again: ORDER F&B shows "Food is not available at this kiosk right now"', async () => {
    await kiosk.tap('HOME', { settleMs: 2000 });
    kiosk.apiOutage(true);
    await kiosk.tap('ORDER F&B', { settleMs: 3000 });
    const message = await kiosk.textStartingWith('Food is not available');
    expect(message).toContain('Please visit the counter');
  });

  await kiosk.step('API back: the kiosk is still running and the home screen works', async () => {
    kiosk.apiOutage(false);
    // The food message has a Close button (unless it has already closed by itself).
    if (await kiosk.hasButton('Close')) await kiosk.tap('Close', { settleMs: 1500 });
    expect(await kiosk.hasButton('Close'), 'Food message closed').toBe(false);
    await kiosk.tap('COMING SOON', { settleMs: 2500 });
    await kiosk.waitForText('Coming Soon');
    expect(await kiosk.hasButton('HOME'), 'Coming Soon opened after the outage').toBe(true);
  });
});
