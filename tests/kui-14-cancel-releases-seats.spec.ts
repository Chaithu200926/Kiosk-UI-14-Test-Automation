// KUI-14: seats the kiosk reserved are released again when the customer cancels.
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, expectReservation, openUpcomingShow, pickFreeSeats, SEAT_CATEGORY } from '../src/flows';

test('KUI-14 Cancel during booking releases the reserved seats', async ({ kiosk }) => {
  const show = await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);

  const since = Date.now();
  const [seat] = (await kiosk.step('Choose a free seat and proceed (the kiosk reserves it)', async () => {
    const seats = await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    return seats;
  }))!;

  const reservation = await kiosk.step(`The backend reserved ${seat}`, async () => expectReservation(kiosk, since, [seat]));

  await kiosk.step('Cancel on the food screen: the kiosk cancels the reservation', async () => {
    const cancelSince = Date.now();
    await kiosk.tap('Cancel', { settleMs: 2500 });
    const cancel = await kiosk.waitForApiCall('content/trans/cancel', cancelSince);
    expect(cancel.status, 'cancel HTTP status').toBe(200);
    expect((cancel.responseBody as { code: number }).code, 'cancel response code').toBe(10001);
    expect(String((cancel.requestBody as { transid: unknown }).transid), 'Cancelled transaction').toBe(String(reservation!.transid));
  });

  await kiosk.step('The kiosk returns to the home screen', async () => {
    await kiosk.waitForText('UPCOMING SHOWS');
  });

  await kiosk.step(`Open the same show again: ${seat} is free on the seat map`, async () => {
    await kiosk.tap('BUY TICKETS', { settleMs: 1500 });
    await kiosk.tap(show.film, { settleMs: 1500 });
    await kiosk.tap(show.time, { settleMs: 2500 });
    await kiosk.waitForText(SEAT_CATEGORY);
  });
  await chooseSeatsType(kiosk, 'General', 1);
  await kiosk.step(`${seat} is available again`, async () => {
    await expect.poll(async () => (await kiosk.seatStates()).get(seat), { timeout: 15_000 }).toBe('available');
  });
});
