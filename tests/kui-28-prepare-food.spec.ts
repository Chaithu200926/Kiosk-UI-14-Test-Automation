// KUI-28: PREPARE FOOD sends a paid food order to the kitchen by its booking ID (content/food/kiosk/prepare).
// The test checks the screen and that an unknown booking ID is refused; preparing a real order needs a paid
// food booking (blocked while wallet payments are blocked on build New14).
import { test, expect } from '../src/fixtures';

const UNKNOWN = 'WZZZZZ1';

test('KUI-28 Prepare food: the booking ID screen refuses an unknown booking', async ({ kiosk }) => {
  await kiosk.step('Open PREPARE FOOD: "PREPARE YOUR FOOD" asks for the booking ID', async () => {
    // A lost tap leaves the home screen (8 Oct 2026, fresh start): tap again.
    await kiosk.tapUntil('PREPARE FOOD', 'PREPARE YOUR FOOD', { settleMs: 2500 });
    expect(await kiosk.hasText('Enter the booking ID of your order. We will send your food to the kitchen.')).toBe(true);
    for (const key of ['CLEAR', '⌫', 'Proceed', 'Cancel']) expect.soft(await kiosk.hasButton(key), `${key} button`).toBe(true);
  });

  await kiosk.step(`Unknown booking ID ${UNKNOWN}: refused (state NOT_FOUND), nothing sent to the kitchen`, async () => {
    const since = Date.now();
    await kiosk.typeKeys(UNKNOWN);
    await kiosk.tap('Proceed', { settleMs: 3000 });
    const call = await kiosk.waitForApiCall('content/food/kiosk/prepare', since);
    const body = call.responseBody as { code: number; output: { state: string; pickupNumber: string } };
    expect((call.requestBody as { bookingReference: string }).bookingReference, 'Booking ID sent').toBe(UNKNOWN);
    expect(body.output.state, 'State').toBe('NOT_FOUND');
    expect(body.output.pickupNumber, 'No pickup number').toBe('');
    // "Incorrect Booking ID. Please try again." is drawn but not exposed to UI Automation (see the screenshot).
    expect(await kiosk.hasText('PREPARE YOUR FOOD'), 'Still on the booking ID screen').toBe(true);
  });

  await kiosk.step('CLEAR empties the box; Cancel returns home', async () => {
    await kiosk.tap('CLEAR', { settleMs: 800 });
    expect(await kiosk.hasText(UNKNOWN), 'Box cleared').toBe(false);
    await kiosk.tap('Cancel', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
