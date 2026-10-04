// KUI-05: the seat category and seat type screen lists the seats with prices, and the total follows the ticket quantity.
// Build New14 asks for the seat category first (e.g. Family / General), then shows that category's seat types.
import { test, expect } from '../src/fixtures';
import { chooseCategory, openUpcomingShow, seatAreas, seatCategories, totalTicketPrice } from '../src/flows';

test('KUI-05 Seat category, seat type and ticket quantity: total = price x quantity', async ({ kiosk }) => {
  await openUpcomingShow(kiosk);

  const categories = await kiosk.step('"SELECT SEAT CATEGORY" lists the categories; Proceed waits for a choice', async () => {
    const list = await seatCategories(kiosk);
    expect(list.length, 'Seat categories').toBeGreaterThan(0);
    test.info().annotations.push({ type: 'seat categories', description: list.join(', ') });
    expect.soft(await kiosk.hasText('Select your preference'), '"Select your preference"').toBe(true);
    expect.soft(await kiosk.isEnabled('Proceed'), 'Proceed before choosing').toBe(false);
    return list;
  });
  // Prefer General (the category the paying tests use).
  const category = categories!.includes('General') ? 'General' : categories![0];

  const areas = await kiosk.step(`Choose ${category}: its seat types are listed with free seats and a KWD price`, async () => {
    await chooseCategory(kiosk, category);
    const list = await seatAreas(kiosk);
    expect(list.length, 'Seat types').toBeGreaterThan(0);
    for (const a of list) {
      expect.soft(a.available, `${a.name} free seats`).toBeGreaterThan(0);
      expect.soft(a.price, `${a.name} price`).toBeGreaterThan(0);
    }
    expect(await kiosk.hasText('Ticket Quantity'), 'Ticket Quantity').toBe(true);
    return list;
  });
  const area = [...areas!].sort((a, b) => b.available - a.available)[0];

  await kiosk.step(`Choose ${area.name}: total = 1 x KWD ${area.price.toFixed(3)}`, async () => {
    await kiosk.tap(area.name);
    expect(await totalTicketPrice(kiosk)).toBeCloseTo(area.price, 3);
  });

  for (const quantity of [2, 3]) {
    await kiosk.step(`Quantity ${quantity}: total = ${quantity} x KWD ${area.price.toFixed(3)}`, async () => {
      await kiosk.tapQuantity('+');
      expect(await totalTicketPrice(kiosk)).toBeCloseTo(area.price * quantity, 3);
    });
  }

  await kiosk.step(`Quantity back to 2 with −: total = 2 x KWD ${area.price.toFixed(3)}`, async () => {
    await kiosk.tapQuantity('−');
    expect(await totalTicketPrice(kiosk)).toBeCloseTo(area.price * 2, 3);
  });

  await kiosk.step('Terms: "By clicking proceed, I agree to the terms & conditions" is shown', async () => {
    expect(await kiosk.hasText('By clicking proceed, I agree to the')).toBe(true);
    expect(await kiosk.hasButton('terms & conditions')).toBe(true);
  });

  await kiosk.step('Cancel leaves the booking and returns to the home screen', async () => {
    await kiosk.tap('Cancel', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
