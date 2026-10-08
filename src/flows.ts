// Booking steps shared by several tests. None of them goes past "Preview and Checkout":
// no mobile number, no sign-in and no payment.
import { expect, test } from '@playwright/test';
import type { Kiosk, Seat } from './kiosk';
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
    // The film titles can still be loading: read the screen again a few times before giving up.
    for (let attempt = 1; ; attempt++) {
      const onScreen = new Set((await kiosk.visibleTexts()).map((t) => t.name));
      try {
        return pickShow(programme.filter((s) => onScreen.has(s.film)), { experience: 'Standard', ...options });
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }))!;
  await kiosk.step(`Choose "${show.film}"`, async () => {
    await kiosk.tapUntil(show.film, show.time, { settleMs: 1500 });
  });
  await kiosk.step(`Choose the ${show.time} ${show.experience} show`, async () => {
    await kiosk.tapUntil(show.time, SEAT_CATEGORY, { settleMs: 2500 });
  });
  return show;
}

/** Heading of the first choice after a show time (build New14; "Select Seat Type" before). */
export const SEAT_CATEGORY = 'SELECT SEAT CATEGORY';

/** Heading of the food screen after the seat map (build New15; "Select Food" before). */
export const FOOD_SCREEN = 'SELECT FOOD';
/** Heading of the cart sheet on the food screen (build New15; "Your order" before). */
export const CART_HEADING = 'Cart';

/** Label of the food menu's add buttons (build New15; "ADD" before). */
export const FOOD_ADD = 'Add';

/** Button that confirms the item sheet (build New15; the sheet had its own ADD before). */
export const SHEET_DONE = 'Done';

/** Seat categories offered for the show, e.g. ["Family", "General"] (each is a tile with an icon and a name). */
export async function seatCategories(kiosk: Kiosk): Promise<string[]> {
  const xml = await kiosk.app.getPageSource();
  const names: string[] = [];
  const blocks = xml.split(/(?:Screens\.)?CategoryChoice/g);
  const parseNames = (source: string) => {
    const matches = [...source.matchAll(/<Text\b[^>]*?(?:AutomationId="Name"[^>]*Name="([^"]*)"|Name="([^"]*)"[^>]*AutomationId="Name")/g)]
      .map(([, first, second]) => first ?? second ?? '')
      .filter(Boolean);
    for (const name of matches) names.push(name);
  };
  if (blocks.length > 1) {
    for (const block of blocks.slice(1)) parseNames(block);
  } else {
    parseNames(xml);
  }
  return [...new Set(names)];
}

/** Taps a seat category; the seat types of that category then appear under "SELECT SEAT TYPE". */
export async function chooseCategory(kiosk: Kiosk, category: string) {
  // A lost tap leaves the screen on the category choice (build New15, 8 Oct 2026): tap again.
  await kiosk.tapUntil(category, 'SELECT SEAT TYPE', { settleMs: 1500, timeout: 8_000, attempts: 3 });
}

/**
 * Seat types under "SELECT SEAT TYPE" with their free seats and price, e.g. Standard: 112 seats, 3.5 KWD.
 * Each tile shows its name, "112 Available" and "KWD 3.500" as three texts.
 */
export async function seatAreas(kiosk: Kiosk) {
  const texts = await kiosk.texts();
  const areas: { name: string; available: number; price: number }[] = [];
  for (let i = 0; i < texts.length - 2; i++) {
    const name = texts[i];
    const seats = texts[i + 1]?.match(/^(\d+) Available$/);
    const price = texts[i + 2]?.match(/^KWD ([\d.]+)$/);
    if (!name || !seats || !price) continue;
    // The seat-type name is the label itself, not the count or the unit price.
    if (/^\d+ Available$/.test(name) || /^KWD [\d.]+$/.test(name)) continue;
    areas.push({ name, available: Number(seats[1]), price: Number(price[1]) });
    i += 2;
  }
  return areas;
}

/** The order total on the cart button at the bottom left of "SELECT FOOD", e.g. "KWD 3.500". */
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
    // Build New15 loses a + tap now and then (8 Oct 2026: KUI-06 went on with 1 ticket instead of 2), so the quantity
    // is checked from the total (price x quantity) and corrected.
    for (let tries = 0; ; tries++) {
      const shown = Math.round((await totalTicketPrice(kiosk)) / area.price);
      if (shown === quantity) break;
      if (tries > quantity + 2) throw new Error(`Ticket quantity stays ${shown}, wanted ${quantity}`);
      await kiosk.tapQuantity(shown < quantity ? '+' : '−');
    }
    await kiosk.tapUntil('Proceed', 'Select Seat', { settleMs: 2500 });
  });
}

/**
 * Chooses `count` free seats next to each other at the edge of a free block, so the kiosk's
 * "no single empty seat" rule never blocks them. Returns labels like ["K27", "K26"].
 */
export async function pickFreeSeats(kiosk: Kiosk, count: number): Promise<string[]> {
  // One read of the map for both the seats and their colours (every read of a big map takes seconds on build New15).
  const seats = await kiosk.seats();
  const states = await kiosk.seatStates(seats);
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
    // On build New15 a seat read as free now and then does not take a tap (it was still being drawn): then the
    // seats taken from that block are released and the next block is tried.
    for (const block of runs.filter((r) => r.length === count || r.length >= count + 2)) {
      const chosen = block.slice(0, count).map((s) => `${s.row}${s.number}`);
      const taken: string[] = [];
      try {
        for (const seat of block.slice(0, count)) { await selectSeat(kiosk, `${seat.row}${seat.number}`, seat); taken.push(`${seat.row}${seat.number}`); }
        return chosen;
      } catch (e) {
        test.info().annotations.push({ type: 'seat block skipped', description: `${chosen.join(' ')}: ${String(e).slice(0, 200)}` });
        for (const label of taken) await kiosk.tapSeat(label);
      }
    }
  }
  const free = [...states.values()].filter((s) => s === 'available').length;
  throw new Error(`No block of ${count} free seat(s) found on the seat map (${seats.length} seats read, ${free} looked free)`);
}

/**
 * Taps a seat and waits until it turns red. The seat map redraws after every selection and a tap during the redraw
 * is lost, so it taps once more if the seat does not turn red. With the seat's place known (`seat`), the colour is
 * read from screenshots (fast); otherwise it waits for the label in the selection.
 */
export async function selectSeat(kiosk: Kiosk, label: string, seat?: Seat) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await kiosk.tapSeat(label, seat);
    let selected = false;
    if (seat) {
      for (let i = 0; i < 10 && !selected; i++) {
        await new Promise((r) => setTimeout(r, 500));
        selected = (await kiosk.seatColours([seat])).get(label) === 'selected';
      }
    } else {
      selected = await kiosk.waitForText(label, 5_000).then(() => true, () => false);
    }
    if (selected) {
      // Let the map finish redrawing before the next tap.
      await new Promise((r) => setTimeout(r, 1_000));
      return;
    }
  }
  throw new Error(`Seat ${label} was tapped twice but was not selected`);
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

/** On "SELECT FOOD": opens the item's tab, taps its Add button and confirms the item sheet (no options chosen). */
export async function addFood(kiosk: Kiosk, item = CHEAP_FOOD) {
  await kiosk.tap(item.tab, { settleMs: 1500 });
  // Each menu row (build New14) is a DataItem "...FoodItemView" holding its ADD button, image, name and price.
  const before = await cartTotal(kiosk);
  const row = () => kiosk.app.$(`//DataItem[@Name="Cinescape.Kiosk.Presentation.Screens.FoodItemView"][.//Text[@Name="${item.name}"]]//Button[@Name="${FOOD_ADD}"]`);
  // A tap while the tab is still loading is lost, so wait for the item sheet (or the total to change) and tap once more if needed.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await row().click();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      // Build New14 opens a sheet for every item (here an optional "Temperature" choice); it repeats the item's
      // name as its title, so the name shows twice while it is open. Confirm it with Done.
      if ((await kiosk.texts()).filter((t) => t === item.name).length > 1) {
        await addFromSheet(kiosk);
        return;
      }
      if ((await cartTotal(kiosk)) !== before) return;
    }
  }
  throw new Error(`Tapping ADD for "${item.name}" did not add it (tapped twice)`);
}

/** True when the food line "Aquafina Water UAT  × 1" (build New15; "1 x Aquafina Water UAT" before) is on the screen. */
export async function hasFoodLine(kiosk: Kiosk, name: string, quantity = 1) {
  const line = new RegExp(`^\\s+×\\s*${quantity}$`);
  return (await kiosk.texts()).some((t) => t === `${quantity} x ${name}` || (t.startsWith(name) && line.test(t.slice(name.length))));
}

/** Confirms the open item sheet with its Done button (build New15). */
export async function addFromSheet(kiosk: Kiosk) {
  await kiosk.tap(SHEET_DONE, { settleMs: 1500 });
}
