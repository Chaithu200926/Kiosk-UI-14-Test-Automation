// KUI-08: a food-only order from ORDER F&B, paid by KNET (fake terminal, no card charged), completes with a food
// pickup number and the kiosk returns home. Uses the cheapest item (KWD 0.500);
// the order is recorded as a "paid booking" note.
import { test, expect } from '../src/fixtures';
import { addFood, cartTotal, CHEAP_FOOD, kwd, FOOD_SCREEN, hasFoodLine } from '../src/flows';
import { expectReturnsHome, payByKnet, successDetails } from '../src/payment';

test('KUI-08 Food purchase end to end, paid by KNET', async ({ kiosk }) => {
  test.setTimeout(6 * 60_000);

  await kiosk.step(`ORDER F&B: add "${CHEAP_FOOD.name}" and check the total`, async () => {
    await kiosk.tap('ORDER F&B', { settleMs: 2500 });
    await kiosk.waitForText(FOOD_SCREEN);
    expect(await cartTotal(kiosk), 'Empty order').toBe(0);
    await addFood(kiosk);
    expect(await cartTotal(kiosk), 'Total after adding the item').toBeCloseTo(CHEAP_FOOD.price, 3);
  });

  await kiosk.step('"Preview and Checkout" lists the item, the total and when it is prepared', async () => {
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
    expect(await hasFoodLine(kiosk, CHEAP_FOOD.name), 'Food line').toBe(true);
    expect(await kiosk.hasTextContaining('Prepared after payment completion'), 'Preparation note (build New15)').toBe(true);
    expect(kwd(await kiosk.textStartingWith('Total '))).toBeCloseTo(CHEAP_FOOD.price, 3);
  });

  const payment = await payByKnet(kiosk);

  await kiosk.step('"Booking Success!" shows the food pickup number, the item, the BOOKING ID and the amount', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    // The instructions show only after the printing (food slip, then card receipt) has finished: on 8 Oct 2026 they
    // came after more than 20 s, so give them 45 s.
    await expect.soft.poll(() => kiosk.hasTextContaining('Your food is being prepared'), { message: 'Pickup instructions', timeout: 45_000 }).toBe(true);
    expect(await hasFoodLine(kiosk, CHEAP_FOOD.name), 'Item').toBe(true);
    const d = await successDetails(kiosk);
    expect(d.foodPickupNumber, 'FOOD PICKUP NO.').toMatch(/^\d+$/);
    expect(d.reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    expect(d.totalPaid, 'Total paid').toBeCloseTo(CHEAP_FOOD.price, 3);
  });

  await expectReturnsHome(kiosk);
});
