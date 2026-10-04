// Booking steps shared by several tests. None of them goes past "Preview and Checkout":
// no mobile number, no sign-in and no payment.
import { expect } from '@playwright/test';
import type { Kiosk } from './kiosk';
import { pickShow, showsFromCalls, type Show } from './programme';

/** "KWD 3.500" → 3.5 */
export const kwd = (text: string) => Number((text.match(/KWD\s*([\d.]+)/) || [])[1] ?? NaN);

/** Picks a show later today with free seats, from the programme the kiosk loaded at start-up. */
export async function upcomingShow(kiosk: Kiosk, options?: Parameters<typeof pickShow>[1]): Promise<Show> {
  await kiosk.waitForApiCall('content/csessions');
  return pickShow(showsFromCalls(kiosk.apiCalls()), options);
}

/**
 * Home → BUY TICKETS → a film on the first screen (no scrolling) that has a show later today →
 * that show, ending on "SELECT SEAT CATEGORY". Returns the chosen show.
 * Standard shows by default: VIP and other experiences have different seat categories (no "General").
 */
export async function openUpcomingShow(kiosk: Kiosk, options?: Parameters<typeof pickShow>[1]): Promise<Show> {
  await kiosk.waitForApiCall('content/csessions');
  const programme = showsFromCalls(kiosk.apiCalls());
  const show = (await kiosk.step('Open BUY TICKETS (films showing now)', async () => {
    await kiosk.tap('BUY TICKETS', { settleMs: 1500 });
    const onScreen = new Set((await kiosk.visibleTexts()).map((t) => t.name));
    return pickShow(programme.filter((s) => onScreen.has(s.film)), { experience: 'Standard', ...options });
  }))!;
  await kiosk.step(`Choose "${show.film}"`, async () => {
    await kiosk.tap(show.film, { settleMs: 1500 });
    await kiosk.waitForText(show.time);
  });
  await kiosk.step(`Choose the ${show.time} ${show.experience} show`, async () => {
    await kiosk.tap(show.time, { settleMs: 2500 });
    await kiosk.waitForText(SEAT_CATEGORY);
  });
  return show;
}

/** Heading of the first choice after a show time (build New14; "Select Seat Type" before). */
export const SEAT_CATEGORY = 'SELECT SEAT CATEGORY';

/** Seat categories offered for the show, e.g. ["Family", "General"] (each is a tile with an icon and a name). */
export async function seatCategories(kiosk: Kiosk): Promise<string[]> {
  const xml = await kiosk.app.getPageSource();
  const names: string[] = [];
  // Each category is a DataItem "...CategoryChoice" holding a Text with AutomationId "Name".
  for (const block of xml.split('Screens.CategoryChoice').slice(1)) {
    const name = block.match(/<Text\b[^>]*AutomationId="Name"[^>]*Name="([^"]*)"/)?.[1]
      ?? block.match(/<Text\b[^>]*Name="([^"]*)"[^>]*AutomationId="Name"/)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** Taps a seat category; the seat types of that category then appear under "SELECT SEAT TYPE". */
export async function chooseCategory(kiosk: Kiosk, category: string) {
  await kiosk.tap(category, { settleMs: 1500 });
  await kiosk.waitForText('SELECT SEAT TYPE');
}

/**
 * Seat types under "SELECT SEAT TYPE" with their free seats and price, e.g. Standard: 112 seats, 3.5 KWD.
 * Each tile shows its name, "112 Available" and "KWD 3.500" as three texts.
 */
export async function seatAreas(kiosk: Kiosk) {
  const texts = await kiosk.texts();
  const areas: { name: string; available: number; price: number }[] = [];
  texts.forEach((t, i) => {
    const seats = texts[i + 1]?.match(/^(\d+) Available$/);
    const price = texts[i + 2]?.match(/^KWD ([\d.]+)$/);
    if (seats && price) areas.push({ name: t, available: Number(seats[1]), price: Number(price[1]) });
  });
  return areas;
}

/** The order total on the cart button at the bottom left of "Select Food" (build New14), e.g. "KWD 3.500". */
export async function cartTotal(kiosk: Kiosk) {
  // Menu prices sit next to their ADD buttons; the cart total is the only KWD text inside a button.
  const el = kiosk.app.$('//Button//Text[starts-with(@Name, "KWD ")]');
  await el.waitForExist({ timeout: 10_000, timeoutMsg: 'No cart total on the food screen' });
  return kwd((await el.getAttribute('Name')) ?? '');
}

/** Reads "Total Ticket Price   KWD 7.000" (NaN when no price is shown yet). */
export async function totalTicketPrice(kiosk: Kiosk) {
  return kwd(await kiosk.textStartingWith('Total Ticket Price'));
}

/** Seat category (e.g. General), its seat type with most free seats, quantity, then Proceed to the seat map. */
export async function chooseSeatsType(kiosk: Kiosk, category: string, quantity: number) {
  await kiosk.step(`Choose ${category}, a seat type and ${quantity} ticket(s), then proceed to the seat map`, async () => {
    await chooseCategory(kiosk, category);
    const [area] = (await seatAreas(kiosk)).sort((a, b) => b.available - a.available);
    if (!area) throw new Error(`No seat type is offered under ${category}`);
    await kiosk.tap(area.name, { settleMs: 800 });
    for (let i = 1; i < quantity; i++) await kiosk.tapQuantity('+');
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Seat');
  });
}

/**
 * Chooses `count` free seats next to each other at the edge of a free block, so the kiosk's
 * "no single empty seat" rule never blocks them. Returns labels like ["K27", "K26"].
 */
export async function pickFreeSeats(kiosk: Kiosk, count: number): Promise<string[]> {
  const states = await kiosk.seatStates();
  const seats = await kiosk.seats();
  const rows = [...new Set(seats.map((s) => s.row))];
  for (const row of rows.reverse()) {
    const inRow = seats.filter((s) => s.row === row).sort((a, b) => a.x - b.x);
    // Split the row into runs of neighbouring free seats (a gap in x means an aisle).
    let run: typeof inRow = [];
    const runs: (typeof inRow)[] = [];
    inRow.forEach((s, i) => {
      const free = states.get(`${s.row}${s.number}`) === 'available';
      const adjacent = i > 0 && s.x - inRow[i - 1].x < s.width * 1.6;
      if (free && run.length && adjacent) run.push(s);
      else { if (run.length) runs.push(run); run = free ? [s] : []; }
    });
    if (run.length) runs.push(run);
    const block = runs.find((r) => r.length === count || r.length >= count + 2);
    if (block) {
      const chosen = block.slice(0, count).map((s) => `${s.row}${s.number}`);
      for (const label of chosen) await selectSeat(kiosk, label);
      return chosen;
    }
  }
  throw new Error(`No block of ${count} free seat(s) found on the seat map`);
}

/**
 * Taps a seat and waits until it shows in the selection bar. The seat map redraws after every
 * selection and a tap during the redraw is lost, so it taps once more if the seat does not appear.
 */
export async function selectSeat(kiosk: Kiosk, label: string) {
  const seat = () => kiosk.seat(label.slice(0, 1), label.slice(1));
  for (let attempt = 1; attempt <= 2; attempt++) {
    await seat().click();
    try {
      await kiosk.waitForText(label, 5_000);
      // Let the map finish redrawing before the next tap.
      await new Promise((r) => setTimeout(r, 1_000));
      return;
    } catch {
      if (attempt === 2) throw new Error(`Seat ${label} was tapped twice but did not appear in the selection`);
    }
  }
}

/** Checks the kiosk reserved the seats (content/trans/reserveseats) and returns the reservation. */
export async function expectReservation(kiosk: Kiosk, since: number, seats: string[]) {
  const call = await kiosk.waitForApiCall('content/trans/reserveseats', since);
  const body = call.responseBody as { code: number; output: { transid: string; seats: string; totalPrice: string; ticketPrice: string } };
  expect(call.status, 'reserveseats HTTP status').toBe(200);
  expect(body.code, 'reserveseats response code').toBe(10001);
  for (const seat of seats) expect(body.output.seats, 'Reserved seats').toContain(seat);
  return body.output;
}

/** The cheapest item on the menu, used by the paying food tests to keep the club card spending low. */
export const CHEAP_FOOD = { tab: 'Beverages', name: 'Aquafina Water UAT', price: 0.5 };

/** On "Select Food": opens the item's tab, taps its ADD button and confirms the item sheet (no options chosen). */
export async function addFood(kiosk: Kiosk, item = CHEAP_FOOD) {
  await kiosk.tap(item.tab, { settleMs: 1500 });
  // Each menu row (build New14) is a DataItem "...FoodItemView" holding its ADD button, image, name and price.
  const before = await cartTotal(kiosk);
  const row = () => kiosk.app.$(`//DataItem[@Name="Cinescape.Kiosk.Presentation.Screens.FoodItemView"][.//Text[@Name="${item.name}"]]//Button[@Name="ADD"]`);
  // A tap while the tab is still loading is lost, so wait for the item sheet (or the total to change) and tap once more if needed.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await row().click();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      // Build New14 opens a sheet for every item (here an optional "Temperature" choice); it repeats the item's
      // name as its title, so the name shows twice while it is open. Confirm it with its ADD.
      if ((await kiosk.texts()).filter((t) => t === item.name).length > 1) {
        await addFromSheet(kiosk);
        return;
      }
      if ((await cartTotal(kiosk)) !== before) return;
    }
  }
  throw new Error(`Tapping ADD for "${item.name}" did not add it (tapped twice)`);
}

/**
 * Taps ADD on the open item sheet. It is the widest ADD on the screen (137 px against 94 px for the menu rows'
 * ADD buttons behind the sheet; rows scrolled out of view can even sit below it, so position does not tell).
 */
export async function addFromSheet(kiosk: Kiosk) {
  let widest: { click(): Promise<unknown> } | undefined;
  let widestW = -1;
  for (const add of await kiosk.buttons('ADD')) {
    const { width } = await add.getSize();
    if (width > widestW) [widest, widestW] = [add, width];
  }
  await widest!.click();
  await new Promise((r) => setTimeout(r, 1500));
}
