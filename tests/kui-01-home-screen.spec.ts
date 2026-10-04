// KUI-01: the kiosk starts without an error and shows the complete home screen (layout of build New14).
import { test, expect } from '../src/fixtures';

test('KUI-01 App start: the home screen loads with all menu buttons', async ({ kiosk }) => {
  // The fixture has already started the app and waited for the main menu.
  await kiosk.step('Kiosk started and the home screen is shown');

  await kiosk.step('Header shows the clock, date and cinema name', async () => {
    const [clock, date, cinema] = await Promise.all(['ClockText', 'DateText', 'CinemaText']
      .map((id) => kiosk.app.$(`~${id}`).getAttribute('Name')));
    // Clock "HH:mm", date like "Tuesday 29-09-2026", and the kiosk's cinema.
    expect.soft(clock, 'Clock').toMatch(/^\d{2}:\d{2}$/);
    expect.soft(date, 'Date').toMatch(/^[A-Z][a-z]+day \d{2}-\d{2}-\d{4}$/);
    expect.soft(cinema, 'Cinema name').toBeTruthy();
  });

  await kiosk.step('Main menu buttons are all present (BUY TICKETS, three tiles, and FOOD AND ACCOUNT)', async () => {
    expect.soft(await kiosk.hasText('Films showing now'), 'BUY TICKETS subtitle').toBe(true);
    expect.soft(await kiosk.hasText('FOOD AND ACCOUNT'), 'FOOD AND ACCOUNT heading').toBe(true);
    for (const label of ['BUY TICKETS', 'ADVANCE BOOKING', 'COMING SOON', 'PICK UP TICKETS', 'ORDER F&B', 'PREPARE FOOD', 'TOP UP', 'REGISTER']) {
      expect.soft(await kiosk.hasButton(label), `${label} button`).toBe(true);
    }
    // Arabic switch and help.
    expect.soft(await kiosk.hasButton('عربي'), 'Arabic button').toBe(true);
    expect.soft(await kiosk.hasButton('?'), 'Help (?) button').toBe(true);
  });

  await kiosk.step('Promo banner and UPCOMING SHOWS with its experience filter are shown', async () => {
    expect.soft(await kiosk.app.$('~Promo').isExisting(), 'Promo banner').toBe(true);
    expect.soft(await kiosk.hasText('UPCOMING SHOWS'), 'UPCOMING SHOWS heading').toBe(true);
    expect.soft(await kiosk.hasButton('All'), '"All" experience filter').toBe(true);
  });

  await kiosk.step('The kiosk loaded today\'s programme from the API', async () => {
    const programme = await kiosk.waitForApiCall('content/csessions');
    expect(programme.status, 'HTTP status of content/csessions').toBe(200);
    expect((programme.responseBody as { code?: number }).code, 'Response code').toBe(10001);
  });
});
