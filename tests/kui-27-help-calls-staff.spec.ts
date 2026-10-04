// KUI-27: the help (?) button on the home screen calls a member of staff (new in build New14): the kiosk sends a
// "Help" alert (content/kiosk-alerts/printer) and tells the customer to wait. Each run sends one alert in UAT.
import { test, expect } from '../src/fixtures';

const WAIT = 'A member of staff has been told and will come to this kiosk. Please wait here.';

test('KUI-27 Help button: staff are alerted and the customer is told to wait', async ({ kiosk }) => {
  const since = Date.now();
  await kiosk.step('Tap ?: "Need help?" tells the customer staff are coming, with the kiosk ID', async () => {
    await kiosk.tap('?', { settleMs: 2000 });
    await kiosk.waitForText('Need help?');
    expect(await kiosk.hasText(WAIT)).toBe(true);
    expect.soft(await kiosk.hasTextContaining('Kiosk '), 'Kiosk ID shown').toBe(true);
  });

  await kiosk.step('The kiosk sent a Help alert for this kiosk (content/kiosk-alerts/printer)', async () => {
    const call = await kiosk.waitForApiCall('content/kiosk-alerts/printer', since);
    const alert = call.requestBody as { severity: string; kioskId: string; cinemaId: string; printerStatus: string };
    expect(call.status, 'HTTP status').toBe(200);
    expect(alert.severity, 'Severity').toBe('Help');
    expect(alert.printerStatus, 'Message to staff').toBe('A customer at the kiosk asked for help');
    expect(alert.kioskId, 'Kiosk ID').toBeTruthy();
    expect(alert.cinemaId, 'Cinema').toBeTruthy();
  });

  await kiosk.step('Close: back on the home screen', async () => {
    await kiosk.tap('Close', { settleMs: 1500 });
    expect(await kiosk.hasText('Need help?'), 'Help message closed').toBe(false);
    expect(await kiosk.hasText('UPCOMING SHOWS'), 'Home screen').toBe(true);
  });
});
