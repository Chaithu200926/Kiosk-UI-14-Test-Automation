// KUI-26: the customer check by emailed code (new in build New14), used by TOP UP and by paying from the wallet.
// From TOP UP: identify with the club card, SEND CODE, then a wrong code is refused and "Use another mobile, email
// or card" goes back. No money is moved. Each run emails a code to the test customer (it is never used).
// The club card number is private (public report): screenshots black it out and the video is paused.
import { test, expect } from '../src/fixtures';
import { sendCode } from '../src/payment';

const WRONG_CODE = '000000';

test('KUI-26 Wallet code: SEND CODE emails a code, a wrong code is refused', async ({ kiosk, config }) => {
  if (!config.customer.clubCard) throw new Error('Set KIOSK_TEST_CLUB_CARD in .env');

  await kiosk.step('TOP UP: "TOP UP YOUR CLUB CARD" asks for the mobile, email or club card', async () => {
    await kiosk.tap('TOP UP', { settleMs: 2500 });
    await kiosk.waitForText('TOP UP YOUR CLUB CARD');
    expect(await kiosk.hasText('Enter your mobile number, email or club card number. We will email you a code.')).toBe(true);
    for (const tab of ['Mobile', 'Email', 'Club card']) expect.soft(await kiosk.hasButton(tab), `${tab} tab`).toBe(true);
    expect.soft(await kiosk.hasTextContaining('+965'), 'Mobile tab starts with +965').toBe(true);
  });

  kiosk.privateOnScreen = true;
  await kiosk.video?.pause();
  const since = Date.now();
  await kiosk.step('Club card: type the card number and SEND CODE', async () => {
    await kiosk.tap('Club card', { settleMs: 1000 });
    await kiosk.typeDigits(config.customer.clubCard);
    // TOP UP uses kiosk/identity/topup/start; sendCode() asks again if UAT says "Too many attempts".
    const start = await sendCode(kiosk, since);
    const body = start.responseBody as { code: number; msg: string; output?: { sentTo?: string } };
    expect(body.code, `Code sent: ${body.msg}`).toBe(10001);
    expect(body.output?.sentTo, 'Sent to').toBe('the email on your account');
  });
  kiosk.video?.resume();

  await kiosk.step('"Enter the code": six boxes, SEND A NEW CODE with a countdown, and another-card link', async () => {
    await kiosk.waitForText('Enter the code');
    expect(await kiosk.hasText('We sent a 6-digit code to the email on your account.')).toBe(true);
    // The button's name carries the countdown, e.g. "SEND A NEW CODE (25)".
    expect.soft(await kiosk.app.$('//Button[starts-with(@Name, "SEND A NEW CODE")]').isExisting(), 'SEND A NEW CODE').toBe(true);
    expect.soft(await kiosk.hasButton('Use another mobile, email or card'), 'Use another mobile, email or card').toBe(true);
  });

  await kiosk.step(`A wrong code (${WRONG_CODE}) is refused (kiosk/identity/verify)`, async () => {
    const verifySince = Date.now();
    await kiosk.typeDigits(WRONG_CODE, null);
    await kiosk.tap('CONFIRM', { settleMs: 2500 });
    const verify = await kiosk.waitForApiCall('kiosk/identity/verify', verifySince);
    const body = verify.responseBody as { code: number; msg: string };
    expect(body.code, 'Refused').not.toBe(10001);
    expect(body.msg).toBe('The code is not correct. Please try again.');
    // The message is drawn but not exposed to UI Automation (see the screenshot); the kiosk stays on the code screen.
    expect(await kiosk.hasText('Enter the code'), 'Still on the code screen').toBe(true);
  });

  await kiosk.step('"Use another mobile, email or card" goes back to SEND CODE; Back returns home', async () => {
    await kiosk.tap('Use another mobile, email or card', { settleMs: 1500 });
    await kiosk.button('SEND CODE');
    await kiosk.tap('Back', { settleMs: 2000 });
    await kiosk.waitForText('UPCOMING SHOWS');
  });
});
