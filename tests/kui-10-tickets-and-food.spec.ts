// KUI-10: 1 ticket and a food item in one order, paid once by KNET (fake terminal, no card charged); the success screen shows both
// the seat and the food pickup number under one BOOKING ID. (The back-office check stays manual.)
// Creates one paid UAT booking of about KWD 4.000 per run (ticket + cheapest item); recorded as a "paid booking" note.
import { test, expect } from '../src/fixtures';
import { addFood, cartTotal, CHEAP_FOOD, chooseSeatsType, kwd, openUpcomingShow, pickFreeSeats, FOOD_SCREEN, hasFoodLine } from '../src/flows';
import { expectReturnsHome, payByKnet, successDetails } from '../src/payment';

test('KUI-10 Tickets and food in one order, paid once by KNET', async ({ kiosk }) => {
  test.setTimeout(8 * 60_000);
  const show = await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);

  const [seat] = (await kiosk.step('Choose a free seat and proceed to "Select Food"', async () => {
    const seats = await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText(FOOD_SCREEN);
    return seats;
  }))!;

  const ticketTotal = (await kiosk.step(`Add "${CHEAP_FOOD.name}": the total rises by its price`, async () => {
    const before = await cartTotal(kiosk);
    await addFood(kiosk);
    expect(await cartTotal(kiosk), 'Total with food').toBeCloseTo(before + CHEAP_FOOD.price, 3);
    return before;
  }))!;

  const total = (await kiosk.step('"Preview and Checkout": tickets + food = total', async () => {
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
    expect(await kiosk.hasText('Tickets    1'), 'Tickets line').toBe(true);
    expect(await hasFoodLine(kiosk, CHEAP_FOOD.name), 'Food line').toBe(true);
    const t = kwd(await kiosk.textStartingWith('Total '));
    expect(t, 'Total').toBeCloseTo(ticketTotal + CHEAP_FOOD.price, 3);
    return t;
  }))!;

  const payment = await payByKnet(kiosk);

  await kiosk.step('"Booking Success!" shows both references (BOOKING ID and FOOD PICKUP NO.), the seat and one total', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    const d = await successDetails(kiosk);
    expect(d.reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    expect(d.foodPickupNumber, 'FOOD PICKUP NO.').toMatch(/^\d+$/);
    expect(await kiosk.hasText(show.film), 'Film').toBe(true);
    expect(d.seats, 'Seat').toEqual([seat]);
    expect(d.totalPaid, 'Total paid (tickets + food)').toBeCloseTo(total, 3);
  });

  await kiosk.step('One KNET payment and one booking for tickets and food', async () => {
    const pays = kiosk.apiCalls().filter((c) => c.time >= payment.since && c.path.startsWith('payment/knet/kiosk/confirm'));
    const bookings = kiosk.apiCalls().filter((c) => c.time >= payment.since && c.path.startsWith('content/trans/tckbooked'));
    expect(pays, 'KNET payments').toHaveLength(1);
    expect(bookings, 'Confirmed bookings').toHaveLength(1);
  });

  await expectReturnsHome(kiosk);
});
