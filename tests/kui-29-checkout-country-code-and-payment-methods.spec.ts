// KUI-29: "Preview and Checkout" on build New14: the mobile number has a country code picker (+965 Kuwait first),
// and the payment methods are KNET / CREDIT CARD, WALLET, GIFT CARD and VOUCHER; WALLET asks for the mobile, email
// or club card before it emails a code. The test stops there (no code is sent, nothing is paid) and cancels:
// the kiosk cancels the seat reservation. The mobile is private: screenshots black it out and the video is paused.
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, expectReservation, kwd, openUpcomingShow, pickFreeSeats } from '../src/flows';

const COUNTRIES = ['Kuwait', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Oman'];
const METHODS = ['KNET / CREDIT CARD', 'WALLET', 'GIFT CARD', 'VOUCHER'];

test('KUI-29 Checkout: country code picker and the payment methods', async ({ kiosk, config }) => {
  if (!config.mobile) throw new Error('Set KIOSK_TEST_MOBILE in .env');
  await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);

  const since = Date.now();
  await kiosk.step('Choose a free seat, proceed and SKIP food', async () => {
    await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    await kiosk.tap('SKIP', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
  });
  const reservation = await expectReservation(kiosk, since, []);
  const total = kwd(await kiosk.textStartingWith('Total '));

  await kiosk.step('"Your mobile number" starts with +965; the picker lists the Gulf country codes', async () => {
    expect(await kiosk.hasText('Your mobile number')).toBe(true);
    expect(await kiosk.hasText('+965'), 'Kuwait (+965) by default').toBe(true);
    await kiosk.tap('+965', { settleMs: 1500 });
    await kiosk.waitForText('Choose your country code');
    for (const country of COUNTRIES) expect.soft(await kiosk.hasText(country), country).toBe(true);
  });

  await kiosk.step('Choose Saudi Arabia: +966 is shown; choose Kuwait again: +965', async () => {
    await kiosk.text('Saudi Arabia').click();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await kiosk.hasText('Choose your country code'), 'Picker closed').toBe(false);
    expect(await kiosk.hasText('+966'), '+966').toBe(true);
    await kiosk.tap('+966', { settleMs: 1500 });
    await kiosk.text('Kuwait').click();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await kiosk.hasText('+965'), 'Back to +965').toBe(true);
  });

  kiosk.privateOnScreen = true;
  await kiosk.video?.pause();
  await kiosk.step('Type the mobile and PROCEED TO PAYMENT: the four payment methods and the amount', async () => {
    await kiosk.typeDigits(config.mobile);
    await kiosk.tap('PROCEED TO PAYMENT', { settleMs: 2500 });
    await kiosk.waitForText('Select Payment Method');
    for (const method of METHODS) expect.soft(await kiosk.hasButton(method), method).toBe(true);
    expect(await kiosk.hasText('CLUB CARD'), 'The old CLUB CARD method is gone').toBe(false);
    expect(await kiosk.hasText('Amount to be paid')).toBe(true);
    expect(await kiosk.hasText(`KWD ${total.toFixed(3)}`), `KWD ${total.toFixed(3)}`).toBe(true);
  });
  kiosk.video?.resume();

  await kiosk.step('WALLET: "PAY FROM YOUR WALLET" asks for the mobile, email or club card (no code is sent)', async () => {
    await kiosk.tap('WALLET', { settleMs: 800 });
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('PAY FROM YOUR WALLET');
    expect(await kiosk.hasText(`KWD ${total.toFixed(3)}`), 'Amount to be paid').toBe(true);
    expect(await kiosk.hasText('Enter your mobile number, email or club card number. We will email you a code.')).toBe(true);
    for (const tab of ['Mobile', 'Email', 'Club card', 'SEND CODE']) expect.soft(await kiosk.hasButton(tab), tab).toBe(true);
  });

  await kiosk.step('Cancel out: the kiosk cancels the reservation', async () => {
    const cancelSince = Date.now();
    await kiosk.backToHome();
    const cancel = await kiosk.waitForApiCall('content/trans/cancel', cancelSince);
    expect((cancel.responseBody as { code: number }).code, 'cancel response code').toBe(10001);
    expect(String((cancel.requestBody as { transid: unknown }).transid), 'Cancelled transaction').toBe(String(reservation.transid));
  });
});
