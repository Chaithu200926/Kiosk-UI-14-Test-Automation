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
  /** Wallet payments: the club card balance the kiosk showed before paying (kiosk/identity/verify), in KWD. */
  balanceBefore?: number;
}

/** Taps the pay button, which reads "PAY KWD 10.000" once an amount is known (build New14), otherwise "PAY". */
export async function tapPay(kiosk: Kiosk, amount: number) {
  const label = `PAY KWD ${amount.toFixed(3)}`;
  for (let i = 0; i < 40 && !(await kiosk.hasButton(label)) && !(await kiosk.hasButton('PAY')); i++) {
    await kiosk.stillHere();
    await new Promise((r) => setTimeout(r, 500));
  }
  await kiosk.tap((await kiosk.hasButton(label)) ? label : 'PAY', { settleMs: 500 });
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

/** Build New15 calls the club card "wallet" on screen: the TOP UP heading, the prompt and the tab. */
export const TOP_UP_HEADING = 'TOP UP YOUR WALLET';
export const WALLET_PROMPT = 'Enter your mobile number, email or wallet number. We will email you a code.';
export const WALLET_TAB = 'Wallet';
/** "PAY FROM YOUR WALLET" on build New15: the code goes to the account of the mobile typed at checkout. */
export const WALLET_CODE_SENT = 'We sent a 6-digit code to the email on your account.';

/** Why the paying tests are skipped while no wallet code is configured (build New14). */
export const WALLET_CODE_MISSING =
  'Set KIOSK_WALLET_CODE in .env: paying from the wallet and topping up need the 6-digit code the kiosk emails to the '
  + 'customer (kiosk/identity/start); UAT accepts 111111 for the test customer since 4 Oct 2026.';

/** Skips a wallet test (before anything is reserved) while no wallet code is configured. */
export function skipUnlessWalletCode() {
  test.skip(!config.customer.walletCode, WALLET_CODE_MISSING);
}

/** What the kiosk knows about the customer after the code check (kiosk/identity/verify). */
export interface WalletCustomer {
  firstName: string;
  maskedCard: string;
  /** Club card balance in KWD. */
  balance: number;
}

/**
 * Taps SEND CODE and returns the kiosk's code request (kiosk/identity/start, or kiosk/identity/topup/start). UAT
 * refuses code requests that come too close together ("Too many attempts. Please try again later."): then it waits a
 * minute and asks again, up to three times, and returns the last answer.
 */
export async function sendCode(kiosk: Kiosk, since = Date.now()) {
  let start;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const tapped = Date.now();
    await kiosk.tap('SEND CODE', { settleMs: 2500 });
    start = await kiosk.waitForApiCall('kiosk/identity/', Math.max(since, tapped));
    const body = start.responseBody as { code: number; msg: string };
    if (body.code === 10001 || !/too many attempts/i.test(body.msg) || attempt === 4) break;
    test.info().annotations.push({ type: 'note', description: `Code request refused ("${body.msg}"); asked again after 60 s (attempt ${attempt + 1}).` });
    await waitOnScreen(kiosk, 60_000);
  }
  return start!;
}

/** Waits without leaving the screen: answers "Are you still there?" with YES, I'M HERE so the kiosk does not go home. */
async function waitOnScreen(kiosk: Kiosk, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await kiosk.hasButton("YES, I'M HERE")) await kiosk.tap("YES, I'M HERE", { settleMs: 1000 });
  }
}

/**
 * On a "Enter your mobile number, email or club card number" panel (TOP UP, or PAY FROM YOUR WALLET): Club card →
 * the card number → SEND CODE (kiosk/identity/start) → the code (KIOSK_WALLET_CODE, 111111 on UAT) → CONFIRM
 * (kiosk/identity/verify). Returns the customer's name, masked card and balance. Screenshots black out the card number.
 */
export async function identifyByCode(kiosk: Kiosk): Promise<WalletCustomer> {
  if (!config.customer.clubCard) throw new Error('Set KIOSK_TEST_CLUB_CARD in .env');
  if (!config.customer.walletCode) throw new Error(WALLET_CODE_MISSING);
  kiosk.privateOnScreen = true;
  await kiosk.step('Wallet: type the card number and SEND CODE (kiosk/identity/start)', async () => {
    const since = Date.now();
    // A lost tap on the tab would type the card number into the mobile field.
    await kiosk.tapUntil(WALLET_TAB, 'Wallet number', { settleMs: 1000 });
    await kiosk.typeDigits(config.customer.clubCard);
    const start = await sendCode(kiosk, since);
    expect((start.responseBody as { code: number; msg: string }).code, 'Code sent').toBe(10001);
    await kiosk.waitForText('Enter the code');
  });
  return confirmCode(kiosk);
}

/** On "Enter the code": types the code (KIOSK_WALLET_CODE, 111111 on UAT), CONFIRM (kiosk/identity/verify). */
export async function confirmCode(kiosk: Kiosk): Promise<WalletCustomer> {
  if (!config.customer.walletCode) throw new Error(WALLET_CODE_MISSING);
  return (await kiosk.step('Enter the code and CONFIRM (kiosk/identity/verify): the customer is known', async () => {
    // The code boxes show no digits to check, and a tap during the screen change is lost: if CONFIRM did not reach
    // the server (no kiosk/identity/verify), clear the boxes and type the code once more.
    let verify;
    for (let attempt = 1; attempt <= 2 && !verify; attempt++) {
      const since = Date.now();
      await kiosk.typeDigits(config.customer.walletCode, null);
      await kiosk.tap('CONFIRM', { settleMs: 2500 });
      verify = await kiosk.waitForApiCall('kiosk/identity/verify', since, 10_000).catch(() => undefined);
      if (!verify) for (let i = 0; i < config.customer.walletCode.length + 2; i++) await kiosk.tap('⌫', { settleMs: 200 });
    }
    if (!verify) throw new Error('The code was typed twice but CONFIRM never reached the server (kiosk/identity/verify)');
    const body = verify.responseBody as { code: number; msg: string; output?: { firstName: string; maskedCard: string; balance: string } };
    expect(body.code, `Code accepted: ${body.msg}`).toBe(10001);
    return { firstName: body.output!.firstName, maskedCard: body.output!.maskedCard, balance: Number(body.output!.balance) };
  }))!;
}

/**
 * From "Preview and Checkout": mobile number → PROCEED TO PAYMENT → WALLET → "PAY FROM YOUR WALLET": the kiosk emails
 * a code to the account of the checkout mobile (build New15; New14 first asked for the mobile, email or club card)
 * → the code → CONFIRM → PAY, until the wallet payment is answered.
 * The code is KIOSK_WALLET_CODE (UAT accepts 111111 since 4 Oct 2026). The video pauses while the mobile and card
 * number are on screen, and screenshots black them out.
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

  await kiosk.step('Choose WALLET: "PAY FROM YOUR WALLET" emails a code to the account of the checkout mobile', async () => {
    await kiosk.tap('WALLET', { settleMs: 800 });
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('PAY FROM YOUR WALLET');
    await kiosk.waitForText('Enter the code');
    expect(await kiosk.hasText(WALLET_CODE_SENT)).toBe(true);
  });

  const customer = await confirmCode(kiosk);

  const since = Date.now();
  await kiosk.step(`Wallet balance KWD ${customer.balance.toFixed(3)}, order total and balance after are shown: PAY KWD ${total.toFixed(3)}`, async () => {
    // "Wallet balance  KWD 233.500 / Order total  KWD 0.500 / Balance after  KWD 233.000" (labels and amounts are separate texts).
    await kiosk.waitForText('Balance after', 20_000);
    expect(await amountInRow(kiosk, 'Wallet balance'), 'Wallet balance = the balance from the code check').toBeCloseTo(customer.balance, 3);
    expect(await amountInRow(kiosk, 'Order total'), 'Order total').toBeCloseTo(total, 3);
    expect(await amountInRow(kiosk, 'Balance after'), 'Balance after = balance - order total').toBeCloseTo(customer.balance - total, 3);
    await tapPay(kiosk, total);
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
    return { amount: total, bookingId, reference, since, balanceBefore: customer.balance };
  });
  // The payment screen is gone once the kiosk has moved on to the result.
  for (let i = 0; i < 60 && (await kiosk.hasText('PAY FROM YOUR WALLET')); i++) await new Promise((r) => setTimeout(r, 500));
  kiosk.video?.resume();
  return payment!;
}

/**
 * The "KWD ..." amount on the same row as a label, e.g. "Wallet balance ... KWD 233.500". In the page the amount comes
 * before its label, so it is matched by screen position (same row, to the right of the label).
 */
async function amountInRow(kiosk: Kiosk, label: string) {
  const xml = await kiosk.app.getPageSource();
  const texts = [...xml.matchAll(/<Text\b[^>]*>/g)].map(([tag]) => ({
    name: (tag.match(/\bName="([^"]*)"/) || [])[1] ?? '',
    x: Number((tag.match(/\bx="(-?\d+)"/) || [])[1]),
    y: Number((tag.match(/\by="(-?\d+)"/) || [])[1]),
    off: /IsOffscreen="True"/.test(tag),
  })).filter((t) => !t.off);
  const at = texts.find((t) => t.name === label);
  if (!at) throw new Error(`"${label}" is not on the screen`);
  const amount = texts.find((t) => /^KWD [\d.]+$/.test(t.name) && Math.abs(t.y - at.y) < 15 && t.x > at.x);
  if (!amount) throw new Error(`No KWD amount next to "${label}"`);
  return kwd(amount.name);
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
