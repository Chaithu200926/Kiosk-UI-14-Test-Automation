// KUI-06: seat map rules. Nothing is reserved: the test never presses Proceed on the seat map.
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, openUpcomingShow, pickFreeSeats } from '../src/flows';

test('KUI-06 Seat selection: unavailable seats are blocked and Proceed needs every seat', async ({ kiosk }) => {
  // The seat map checks and going back home took 403 s on build New15 (8 Oct 2026), past the 5-minute limit.
  test.setTimeout(8 * 60_000);
  const show = await openUpcomingShow(kiosk, { minSeats: 20 });
  await chooseSeatsType(kiosk, 'General', 2);

  await kiosk.step('Seat map shows the screen, the legend and free seats', async () => {
    for (const label of ['SCREEN', 'Available', 'Unavailable', 'Selected']) {
      expect.soft(await kiosk.hasText(label), label).toBe(true);
    }
    const states = [...(await kiosk.seatStates()).values()];
    expect(states.filter((s) => s === 'available').length, 'Free seats').toBeGreaterThan(1);
    expect(await kiosk.isEnabled('Proceed'), 'Proceed before choosing seats').toBe(false);
  });

  await kiosk.step('An unavailable seat cannot be selected', async () => {
    // A seat counts as unavailable only when two separate reads agree: on 8 Oct 2026 a read taken while "Are you
    // still there?" was fading in showed a free seat (K18) as grey.
    await kiosk.stillHere();
    const first = await kiosk.seatStates();
    await new Promise((r) => setTimeout(r, 1500));
    const states = await kiosk.seatStates();
    const blocked = [...states.entries()].find(([label, s]) => s === 'unavailable' && first.get(label) === 'unavailable')?.[0];
    if (!blocked) {
      test.info().annotations.push({ type: 'note', description: 'No unavailable seat on this seat map; check skipped.' });
      return;
    }
    await kiosk.tapSeat(blocked);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await kiosk.hasText(blocked), `${blocked} is not in the selection`).toBe(false);
    expect((await kiosk.seatStates()).get(blocked), `${blocked} is not selected`).not.toBe('selected');
  });

  const [first, second] = (await kiosk.step('Choose two neighbouring free seats', async () => pickFreeSeats(kiosk, 2)))!;

  await kiosk.step(`Both seats (${first}, ${second}) are selected and Proceed is enabled`, async () => {
    const states = await kiosk.seatStates();
    expect(states.get(first), first).toBe('selected');
    expect(states.get(second), second).toBe('selected');
    expect(await kiosk.isEnabled('Proceed'), 'Proceed with all seats chosen').toBe(true);
  });

  await kiosk.step(`Tap ${second} again: it is released and Proceed is disabled`, async () => {
    await kiosk.tapSeat(second);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await kiosk.hasText(second), `${second} left the selection`).toBe(false);
    expect(await kiosk.isEnabled('Proceed'), 'Proceed with one seat missing').toBe(false);
  });

  await kiosk.step('Reset clears the selection', async () => {
    await kiosk.tap('Reset', { settleMs: 1000 });
    expect(await kiosk.hasText(first), `${first} cleared`).toBe(false);
  });
});
