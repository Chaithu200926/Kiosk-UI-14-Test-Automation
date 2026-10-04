// KUI-07: buy 1 ticket end to end, paid by KNET (the test kiosk's fake terminal approves; no card is charged).
// KUI-16: pick up that booking by its BOOKING ID; a second pickup is refused.
// The two run in order in one file, so the pickup test reuses KUI-07's booking instead of buying another.
// Creates one paid UAT booking (about KWD 3.500) per run; the BOOKING ID is recorded as a "paid booking" note.
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, kwd, openUpcomingShow, pickFreeSeats } from '../src/flows';
import { expectReturnsHome, payByKnet, successDetails } from '../src/payment';

test.describe.configure({ mode: 'serial' });

// Set by KUI-07, used by KUI-16.
let bought: { reference: string; film: string; seat: string } | undefined;

test('KUI-07 Ticket purchase end to end, paid by KNET', async ({ kiosk }) => {
  test.setTimeout(8 * 60_000);
  const show = await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);

  const [seat] = (await kiosk.step('Choose a free seat and proceed', async () => {
    const seats = await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    return seats;
  }))!;

  const total = await kiosk.step('SKIP food: "Preview and Checkout" shows the film, show, seat and total', async () => {
    await kiosk.tap('SKIP', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
    expect(await kiosk.hasText(show.film), 'Film').toBe(true);
    expect(await kiosk.hasText(seat), 'Seat').toBe(true);
    expect(await kiosk.hasText('Tickets    1'), 'Tickets line').toBe(true);
    return kwd(await kiosk.textStartingWith('Total '));
  });

  const payment = await payByKnet(kiosk);

  const details = (await kiosk.step('"Booking Success!" shows the BOOKING ID, show, seat and amount paid', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    const d = await successDetails(kiosk);
    expect(d.reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    expect(await kiosk.hasText(show.film), 'Film').toBe(true);
    expect(d.dateTime, 'Date & time').toContain(show.time);
    // Build New14 shows the category and seat type, e.g. "General · Standard".
    expect(d.category, 'Category').toContain('General');
    expect(d.seats, 'Seats').toEqual([seat]);
    expect(d.totalPaid, 'Total paid').toBeCloseTo(total!, 3);
    return d;
  }))!;

  await kiosk.step('The ticket and the card receipt are printed: "Please collect your tickets." and EMAIL MY TICKETS is offered', async () => {
    await kiosk.waitForText('Please collect your tickets.', 60_000);
    expect.soft(await kiosk.hasText('Please take everything from the printer'), 'Take everything from the printer').toBe(true);
    expect.soft(await kiosk.hasText('1. Your tickets (1)'), 'Printed: your tickets').toBe(true);
    expect.soft(await kiosk.hasText('2. Your card receipt'), 'Printed: card receipt').toBe(true);
    expect(await kiosk.hasButton('EMAIL MY TICKETS'), 'EMAIL MY TICKETS').toBe(true);
  });

  bought = { reference: details.reference, film: show.film, seat };
  await expectReturnsHome(kiosk);
});

test('KUI-16 Pickup tickets by BOOKING ID; a second pickup is refused', async ({ kiosk }) => {
  test.setTimeout(5 * 60_000);
  if (!bought) throw new Error('KUI-16 picks up the booking bought by KUI-07: run the whole file.');
  const { reference, film, seat } = bought;

  await kiosk.step('Unknown BOOKING ID: "Booking not found", the kiosk stays on the pickup screen', async () => {
    await kiosk.tap('PICK UP TICKETS', { settleMs: 2000 });
    await kiosk.waitForText('ENTER YOUR BOOKING ID');
    const since = Date.now();
    await kiosk.typeKeys('ZZ9Z9Z');
    await kiosk.tap('Proceed', { settleMs: 3000 });
    const call = await kiosk.waitForApiCall('history/kiosk/booking', since);
    expect((call.responseBody as { msg: string }).msg).toBe('Booking not found');
    expect(await kiosk.hasText('ENTER YOUR BOOKING ID'), 'Still on the pickup screen').toBe(true);
  });

  await kiosk.step(`Pick up ${reference}: the booking is found and the tickets are printed`, async () => {
    await kiosk.tap('CLEAR', { settleMs: 500 });
    const since = Date.now();
    await kiosk.typeKeys(reference);
    await kiosk.tap('Proceed', { settleMs: 3000 });
    const lookup = await kiosk.waitForApiCall('history/kiosk/booking', since);
    const booking = (lookup.responseBody as { output: { status: string; seats: string[]; ticketCollected: boolean } }).output;
    expect(booking.status, 'Booking status').toBe('CONFIRMED');
    expect(booking.seats, 'Seats').toEqual([seat]);
    if (!booking.ticketCollected) {
      test.info().annotations.push({
        type: 'possible defect',
        description: 'Tickets printed at purchase are not marked as collected, so the first pickup prints them again.',
      });
    }
    await kiosk.waitForText('Please collect your tickets.', 60_000);
    expect(await kiosk.hasText(film), 'Film').toBe(true);
    expect(await kiosk.hasText(reference), 'BOOKING ID').toBe(true);
    await kiosk.waitForApiCall('history/kiosk/mark-collected', since, 30_000);
  });

  await kiosk.step('Second pickup of the same BOOKING ID is refused (tickets already collected)', async () => {
    await kiosk.tap('HOME', { settleMs: 2000 });
    await kiosk.tap('PICK UP TICKETS', { settleMs: 2000 });
    const since = Date.now();
    await kiosk.typeKeys(reference);
    await kiosk.tap('Proceed', { settleMs: 4000 });
    const lookup = await kiosk.waitForApiCall('history/kiosk/booking', since);
    expect((lookup.responseBody as { output: { ticketCollected: boolean } }).output.ticketCollected, 'ticketCollected').toBe(true);
    // The message "Tickets have already been collected for this Booking ID..." is drawn but not exposed to
    // UI Automation (see the screenshot); check that nothing was printed and the kiosk stayed on the pickup screen.
    expect(await kiosk.hasText('ENTER YOUR BOOKING ID'), 'Still on the pickup screen').toBe(true);
    expect(await kiosk.hasText('Please collect your tickets.'), 'No tickets printed').toBe(false);
    expect(kiosk.apiCalls().filter((c) => c.time >= since && c.path.startsWith('history/kiosk/mark-collected')), 'No second collection').toHaveLength(0);
  });
});
