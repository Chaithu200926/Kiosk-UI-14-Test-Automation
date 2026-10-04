// Paying (KNET with the fake terminal, or the wallet) and reading the result, shared by the purchase tests
// (KUI-07, 08, 10, 11, 16, 17). KNET payments charge no card but create real paid UAT bookings; wallet payments
// spend real UAT club card money. Kiosk bookings are not in the customer's web account, so they
// cannot be cancelled online: every paid BOOKING ID is recorded as a "paid booking" note in the report instead.
import { expect, test } from '@playwright/test';
import { config } from './config';
import { kwd } from './flows';
import type { Kiosk } from './kiosk';

export interface Payment {
  /** Amount charged to the club card, in KWD. */
  amount: number;
  /** Internal booking number, e.g. "2003465". */
  bookingId: string;
  /** BOOKING ID the kiosk confirmed (content/trans/tckbooked "kioskId"), e.g. "WK4TD8Q". */
  reference: string;
  /** The kiosk's calls after PAY started (payment, booking confirmation, ...). */
  since: number;
}

/**
 * From "Preview and Checkout": mobile number → PROCEED TO PAYMENT → KNET / CREDIT CARD → Proceed, until the
 * payment is confirmed and the booking booked. The test kiosk uses the fake card terminal (UseFakeTerminal=true in
 * kiosk.settings.json): it approves at once with authorization code FAKE01 and no card is charged, but the backend
 * records a real, paid UAT booking (checked on build New14, 4 Oct 2026: booking WPJ75C8).
 * Calls: payment/knet/kiosk/hmac (amount, trackId) → payment/knet/kiosk/confirm (PAID YES) → content/trans/tckbooked.
 */
export async function payByKnet(kiosk: Kiosk): Promise<Payment> {
  if (!config.mobile) throw new Error('Set KIOSK_TEST_MOBILE in .env');
  const total = kwd(await kiosk.textStartingWith('Total '));
  kiosk.privateOnScreen = true;
  await kiosk.video?.pause();

  await kiosk.step('Enter the mobile number (+965) and proceed to payment', async () => {
    expect(await kiosk.hasText('+965'), 'Country code +965 is chosen').toBe(true);
    await kiosk.typeDigits(config.mobile);
    await kiosk.tap('PROCEED TO PAYMENT', { settleMs: 2500 });
    await kiosk.waitForText('Select Payment Method');
    expect(await kiosk.hasText(`KWD ${total.toFixed(3)}`), `Amount to be paid KWD ${total.toFixed(3)}`).toBe(true);
  });
  kiosk.video?.resume();

  const since = Date.now();
  await kiosk.step('Choose KNET / CREDIT CARD and Proceed (the fake terminal approves)', async () => {
    await kiosk.tap('KNET / CREDIT CARD', { settleMs: 800 });
    await kiosk.tap('Proceed', { settleMs: 1000 });
  });

  return (await kiosk.step('The KNET payment is confirmed and the booking booked (payment/knet/kiosk/confirm, content/trans/tckbooked)', async () => {
    const hmac = await kiosk.waitForApiCall('payment/knet/kiosk/hmac', since, 60_000);
    const start = hmac.responseBody as { code: number; msg: string; output?: { amount: string; bookingId: string } };
    expect(start.code, `KNET start: ${start.msg}`).toBe(10001);
    expect(Number(start.output?.amount) / 1000, 'Amount sent to the terminal (fils)').toBeCloseTo(total, 3);
    const bookingId = start.output!.bookingId;
    const note = { type: 'paid booking', description: paidNote(`booking ${bookingId}`, total, 'KNET (fake terminal)') };
    test.info().annotations.push(note);

    const confirm = await kiosk.waitForApiCall('payment/knet/kiosk/confirm', since, 120_000);
    const answer = confirm.responseBody as { code: number; msg: string; output?: { PAID: string } };
    expect(answer.code, `KNET confirm: ${answer.msg}`).toBe(10001);
    expect(answer.output?.PAID, 'PAID').toBe('YES');
    expect((confirm.requestBody as { errorDescription?: string }).errorDescription, 'Terminal answer').toBe('APPROVED');

    const booked = await kiosk.waitForApiCall('content/trans/tckbooked', since, 60_000);
    const confirmation = booked.responseBody as { code: number; msg: string; output?: { bookingId: string; kioskId: string } };
    expect(confirmation.code, `Booking confirmation: ${confirmation.msg}`).toBe(10001);
    expect(confirmation.output?.bookingId, 'Same booking as the payment').toBe(bookingId);
    const reference = confirmation.output!.kioskId;
    note.description = paidNote(`BOOKING ID ${reference} (booking ${bookingId})`, total, 'KNET (fake terminal)');
    return { amount: total, bookingId, reference, since };
  }))!;
}

/** Why the paying tests are skipped while no wallet code is configured (build New14). */
export const WALLET_CODE_MISSING =
  'Blocked on build New14: paying from the wallet needs the 6-digit code the kiosk emails to the customer '
  + '(kiosk/identity/start), and UAT rejects 111111 for the test customer (tried by club card and by mobile on 4 Oct 2026; the code always goes to the account email). Set KIOSK_WALLET_CODE in .env '
  + 'once UAT has a fixed code for the test customer.';

/** Skips a paying test (before anything is reserved) while no wallet code is configured. */
export function skipUnlessWalletCode() {
  test.skip(!config.customer.walletCode, WALLET_CODE_MISSING);
}

/**
 * From "Preview and Checkout": mobile number → PROCEED TO PAYMENT → WALLET → "PAY FROM YOUR WALLET":
 * identify with the club card number → SEND CODE → the emailed code → CONFIRM → PAY, until the wallet payment is
 * answered. (Build New14 replaced the CLUB CARD method, where only the card number was typed, with this.)
 * The steps up to the code were checked on the kiosk on 4 Oct 2026; the screen after CONFIRM follows the build's
 * texts ("Wallet balance", "Balance after") and is not seen yet. The video pauses while the mobile and card number
 * are on screen, and screenshots black them out.
 */
export async function payByWallet(kiosk: Kiosk): Promise<Payment> {
  if (!config.mobile || !config.customer.clubCard) throw new Error('Set KIOSK_TEST_MOBILE and KIOSK_TEST_CLUB_CARD in .env');
  if (!config.customer.walletCode) throw new Error(WALLET_CODE_MISSING);
  const total = kwd(await kiosk.textStartingWith('Total '));
  kiosk.privateOnScreen = true;
  await kiosk.video?.pause();

  await kiosk.step('Enter the mobile number (+965) and proceed to payment', async () => {
    expect(await kiosk.hasText('+965'), 'Country code +965 is chosen').toBe(true);
    await kiosk.typeDigits(config.mobile);
    await kiosk.tap('PROCEED TO PAYMENT', { settleMs: 2500 });
    await kiosk.waitForText('Select Payment Method');
    expect(await kiosk.hasText(`KWD ${total.toFixed(3)}`), `Amount to be paid KWD ${total.toFixed(3)}`).toBe(true);
  });

  await kiosk.step('Choose WALLET: "PAY FROM YOUR WALLET" asks for the mobile, email or club card', async () => {
    await kiosk.tap('WALLET', { settleMs: 800 });
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('PAY FROM YOUR WALLET');
    expect(await kiosk.hasText('Enter your mobile number, email or club card number. We will email you a code.')).toBe(true);
  });

  await kiosk.step('Club card: type the card number and SEND CODE (kiosk/identity/start)', async () => {
    const since = Date.now();
    await kiosk.tap('Club card', { settleMs: 1000 });
    await kiosk.typeDigits(config.customer.clubCard);
    await kiosk.tap('SEND CODE', { settleMs: 2500 });
    const start = await kiosk.waitForApiCall('kiosk/identity/start', since);
    expect((start.responseBody as { code: number; msg: string }).code, 'Code sent').toBe(10001);
    await kiosk.waitForText('Enter the code');
  });

  const since = Date.now();
  await kiosk.step('Enter the code, CONFIRM (kiosk/identity/verify), then PAY', async () => {
    await kiosk.typeDigits(config.customer.walletCode, null);
    await kiosk.tap('CONFIRM', { settleMs: 2500 });
    const verify = await kiosk.waitForApiCall('kiosk/identity/verify', since);
    expect((verify.responseBody as { code: number; msg: string }).code, `Code accepted: ${(verify.responseBody as { msg: string }).msg}`).toBe(10001);
    await kiosk.waitForText('Wallet balance', 20_000);
    await kiosk.tap('PAY', { settleMs: 500 });
  });

  const payment = await kiosk.step('The wallet payment is approved and the booking confirmed (clubcard/kiosk/pay, content/trans/tckbooked)', async () => {
    const call = await kiosk.waitForApiCall('clubcard/kiosk/pay', since, 90_000);
    const body = call.responseBody as { code: number; msg: string; output?: { amount: string; PAID: string; bookingId: string } };
    expect(call.status, 'HTTP status').toBe(200);
    expect(body.code, `Payment answer: ${body.msg}`).toBe(10001);
    expect(body.output?.PAID, 'PAID').toBe('YES');
    const bookingId = body.output!.bookingId;
    // Record the paid booking straight away, so it is in the report even if a later check fails.
    const note = { type: 'paid booking', description: paidNote(`booking ${bookingId}`, total) };
    test.info().annotations.push(note);
    expect(kwd(body.output!.amount), 'Amount charged').toBeCloseTo(total, 3);

    const booked = await kiosk.waitForApiCall('content/trans/tckbooked', since, 60_000);
    const confirmation = booked.responseBody as { code: number; msg: string; output?: { bookingId: string; kioskId: string } };
    expect(confirmation.code, `Booking confirmation: ${confirmation.msg}`).toBe(10001);
    expect(confirmation.output?.bookingId, 'Same booking as the payment').toBe(bookingId);
    const reference = confirmation.output!.kioskId;
    note.description = paidNote(`BOOKING ID ${reference} (booking ${bookingId})`, total);
    return { amount: total, bookingId, reference, since };
  });
  // The payment screen is gone once the kiosk has moved on to the result.
  for (let i = 0; i < 60 && (await kiosk.hasText('PAY FROM YOUR WALLET')); i++) await new Promise((r) => setTimeout(r, 500));
  kiosk.video?.resume();
  return payment!;
}

/** Text of the report note for a paid booking, so it can be cancelled or refunded in the back office. */
function paidNote(booking: string, amount: number, method = 'the wallet (club card)') {
  return `${booking}, KWD ${amount.toFixed(3)} paid by ${method}. Not cancelled: kiosk bookings cannot be cancelled online.`;
}

/**
 * The details on "Booking Success!": BOOKING ID, DATE & TIME, CATEGORY, SCREEN, SEATS, FOOD PICKUP NO. and
 * TOTAL PAID. (Ticket orders show "TOTAL PAID   KWD 3.500" as one text; food-only orders as two.)
 */
export async function successDetails(kiosk: Kiosk) {
  const texts = await kiosk.texts();
  const has = (label: string) => texts.includes(label);
  const after = (label: string) => (has(label) ? texts[texts.indexOf(label) + 1] ?? '' : '');
  const seatsAt = texts.indexOf('SEATS');
  const totalAt = texts.findIndex((t) => t.startsWith('TOTAL PAID'));
  const totalText = totalAt < 0 ? '' : texts[totalAt] === 'TOTAL PAID' ? texts[totalAt + 1] ?? '' : texts[totalAt];
  return {
    reference: after('BOOKING ID'),
    dateTime: after('DATE & TIME').replace(/\s+/g, ' '),
    category: after('CATEGORY'),
    screen: after('SCREEN'),
    seats: seatsAt >= 0 && totalAt > seatsAt ? texts.slice(seatsAt + 1, totalAt) : [],
    foodPickupNumber: after('FOOD PICKUP NO.'),
    totalPaid: kwd(totalText),
  };
}

/** After a purchase the kiosk goes back to the home screen by itself (about 30 s on this kiosk). */
export async function expectReturnsHome(kiosk: Kiosk) {
  await kiosk.step('The kiosk returns to the home screen by itself', async () => {
    const start = Date.now();
    await kiosk.waitForText('UPCOMING SHOWS', 120_000);
    test.info().annotations.push({ type: 'timing', description: `Back on the home screen ${Math.round((Date.now() - start) / 1000)} s after the success screen was read.` });
  });
}
