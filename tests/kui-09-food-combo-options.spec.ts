// KUI-09: a food combo with options is added to a ticket order and carried to "Preview and Checkout".
// The test stops there and cancels: no mobile number, no payment.
import { test, expect } from '../src/fixtures';
import { addFromSheet, cartTotal, chooseSeatsType, expectReservation, kwd, openUpcomingShow, pickFreeSeats, FOOD_ADD, FOOD_SCREEN, SHEET_DONE, hasFoodLine } from '../src/flows';

const COMBO = 'Medium Popcorn & Soda COMBO2';

test('KUI-09 Food combo options carry through to checkout', async ({ kiosk }) => {
  const show = await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);

  const since = Date.now();
  const [seat] = (await kiosk.step('Choose a free seat and proceed (the kiosk reserves it)', async () => {
    const seats = await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText(FOOD_SCREEN);
    return seats;
  }))!;
  const reservation = await expectReservation(kiosk, since, [seat]);

  const ticketsTotal = await kiosk.step('Food screen shows the menu tabs and the tickets total', async () => {
    for (const tab of ['Combos', 'Snacks', 'Popcorn', 'Beverages']) expect.soft(await kiosk.hasText(tab), `${tab} tab`).toBe(true);
    return cartTotal(kiosk);
  });

  const comboPrice = await kiosk.step(`Add "${COMBO}" and choose its options`, async () => {
    const texts = await kiosk.texts();
    const price = kwd(texts[texts.indexOf(COMBO) + 1] ?? '');
    await kiosk.tap(FOOD_ADD);
    // The options open as a sheet (option groups, quantity and Done; build New15's ✕ has no name).
    await kiosk.button(SHEET_DONE);
    await kiosk.waitForText('Caramel');
    await kiosk.tap('Caramel', { settleMs: 400 });
    await kiosk.tap('Pepsi', { settleMs: 400 });
    return price;
  });

  await kiosk.step('Done on the sheet: the cart button total rises by the combo price', async () => {
    await addFromSheet(kiosk);
    expect(await cartTotal(kiosk), 'Cart button total').toBeCloseTo(ticketsTotal! + comboPrice!, 3);
  });

  await kiosk.step('The cart ("Your order") lists the combo with its options and the total', async () => {
    await kiosk.tap(`KWD ${(ticketsTotal! + comboPrice!).toFixed(3)}`, { settleMs: 1500 });
    await kiosk.waitForText('Your order');
    expect(await kiosk.hasText(COMBO), 'Combo in the cart').toBe(true);
    expect(await kiosk.hasText('Caramel, Pepsi'), 'Chosen options in the cart').toBe(true);
    expect(kwd(await kiosk.textStartingWith('Total'))).toBeCloseTo(ticketsTotal! + comboPrice!, 3);
  });

  await kiosk.step('Preview and Checkout lists tickets, food and the grand total', async () => {
    // The cart's Proceed is the last Proceed on the screen.
    await kiosk.tap('Proceed', { nth: (await kiosk.buttons('Proceed')).length, settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
    expect(await hasFoodLine(kiosk, COMBO), 'Food line').toBe(true);
    expect(kwd(await kiosk.textStartingWith('Total '))).toBeCloseTo(ticketsTotal! + comboPrice!, 3);
    expect(await kiosk.hasText('TIME REMAINING TO COMPLETE BOOKING'), 'Booking timer').toBe(true);
  });

  await kiosk.step('Cancel out of checkout: the kiosk cancels the reservation', async () => {
    const cancelSince = Date.now();
    await kiosk.backToHome();
    const cancel = await kiosk.waitForApiCall('content/trans/cancel', cancelSince);
    expect((cancel.responseBody as { code: number }).code, 'cancel response code').toBe(10001);
    expect(String((cancel.requestBody as { transid: unknown }).transid), 'Cancelled transaction').toBe(String(reservation.transid));
  });
});
