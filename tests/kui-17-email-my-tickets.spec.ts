// KUI-17: after a ticket purchase, EMAIL MY TICKETS sends the tickets to the test customer's mailbox.
// The option is only offered on "Booking Success!", so the test buys 1 ticket first (about KWD 3.500 of the
// test club card, recorded as a "paid booking" note). The result is the server's answer to the kiosk's history/resend
// call plus the kiosk's message; whether the email arrives stays a manual check.
// The address is private (public report): screenshots black it out and the video stays paused from checkout on.
import { test, expect } from '../src/fixtures';
import { chooseSeatsType, openUpcomingShow, pickFreeSeats } from '../src/flows';
import { expectReturnsHome, payByWallet, successDetails } from '../src/payment';

// On hold on request (4 Oct 2026): the email ticket scenario is parked, and it also needs a wallet payment.
test.skip(true, 'On hold on request (4 Oct 2026): email my tickets is parked for now.');

const SENT = 'Your tickets are on their way to your email.';
const FAILED = 'The email could not be sent. Your paper tickets are all you need.';

test('KUI-17 Email my tickets after a purchase', async ({ kiosk, config }) => {
  test.setTimeout(8 * 60_000);
  // The kiosk's email keyboard has lower-case letters, digits and . _ - only (no @: the ending is chosen separately).
  const email = config.customer.ticketsEmail.toLowerCase();
  const [name, domain] = email.split('@');
  if (!name || !domain || !/^[a-z0-9._-]+$/.test(name + domain)) {
    throw new Error('Set KIOSK_TEST_EMAIL (or KIOSK_TEST_USERNAME) in .env to an address typeable on the kiosk keyboard');
  }

  await openUpcomingShow(kiosk);
  await chooseSeatsType(kiosk, 'General', 1);
  await kiosk.step('Choose a free seat, SKIP food and go to "Preview and Checkout"', async () => {
    await pickFreeSeats(kiosk, 1);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    await kiosk.tap('SKIP', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
  });

  const payment = await payByWallet(kiosk);
  // The success screen goes home by itself after about 36 s: open the email screen straight away.
  await kiosk.step('"Booking Success!" offers EMAIL MY TICKETS', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    expect((await successDetails(kiosk)).reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    await kiosk.tap('EMAIL MY TICKETS', { settleMs: 1500 });
  });

  // The address goes on screen from here on.
  await kiosk.video?.pause();

  const endings = (await kiosk.step('"Email my tickets": a box for the name before the @ and the endings to choose from', async () => {
    await kiosk.waitForText('Email my tickets');
    expect(await kiosk.hasText('Your email, before the @'), 'Name box').toBe(true);
    expect(await kiosk.hasText('Choose the ending'), 'Endings').toBe(true);
    const shown = (await kiosk.texts()).filter((t) => t.startsWith('@'));
    expect(await kiosk.hasButton('OTHER'), 'OTHER ending').toBe(true);
    test.info().annotations.push({ type: 'email endings', description: [...shown, 'OTHER'].join(', ') });
    return shown;
  }))!;

  await kiosk.step('Type the name before the @ and choose the ending', async () => {
    await kiosk.typeText(name);
    if (endings.includes(`@${domain}`)) {
      await kiosk.tap(`@${domain}`);
    } else {
      // Not one of the listed endings: OTHER, then type the domain.
      await kiosk.tap('OTHER');
      await kiosk.typeText(domain);
    }
  });

  await kiosk.step('Send: "Is this correct?" shows the whole address', async () => {
    await kiosk.tap('Send', { settleMs: 1500 });
    await kiosk.waitForText('Is this correct?');
    const whole = (await kiosk.hasTextContaining(email)) || ((await kiosk.hasTextContaining(name)) && (await kiosk.hasTextContaining(domain)));
    expect(whole, 'The address to confirm').toBe(true);
    expect(await kiosk.hasButton('Change'), 'Change').toBe(true);
  });

  const since = Date.now();
  const resend = (await kiosk.step('Confirm: the kiosk asks the server to email the tickets (history/resend)', async () => {
    // The confirmation's Send is the last Send on the screen (the email screen's own Send is behind it).
    const sends = await kiosk.buttons('Send');
    await sends[sends.length - 1].click();
    const call = await kiosk.waitForApiCall('history/resend', since, 30_000);
    // Let the kiosk show the result for the screenshot.
    await new Promise((r) => setTimeout(r, 2000));
    return call;
  }))!;

  await kiosk.step(`The email is sent: "${SENT}"`, async () => {
    const body = resend.responseBody as { code: number; msg: string };
    expect(resend.status, 'history/resend HTTP status').toBe(200);
    // When the server refuses, the kiosk shows FAILED in a red banner (drawn, but not exposed to UI Automation).
    expect(body.code, `history/resend answered "${body.msg}", so the kiosk shows "${FAILED}"`).toBe(10001);
    await kiosk.waitForText(SENT, 15_000);
  });

  test.info().annotations.push({
    type: 'manual check',
    description: `Check the test mailbox for the tickets email of BOOKING ID ${payment.reference}.`,
  });
  await expectReturnsHome(kiosk);
});
