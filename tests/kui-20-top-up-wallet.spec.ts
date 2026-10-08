// KUI-20: TOP UP adds money to the customer's club card. The customer is checked by the emailed code (111111 on
// UAT; one code request only, UAT refuses more in a short time), chooses KWD 10 and pays by KNET; the test kiosk's fake terminal approves without charging a card, so every
// run adds a real KWD 10 to the test club card in UAT (agreed on 4 Oct 2026). The card number is private: screenshots
// black it out and the video is paused while it is typed.
import { test, expect } from '../src/fixtures';
import { kwd } from '../src/flows';
import { identifyByCode, skipUnlessWalletCode, tapPay, TOP_UP_HEADING } from '../src/payment';

skipUnlessWalletCode();

const AMOUNT = 10;

test('KUI-20 Top up the club card with KWD 10 by KNET', async ({ kiosk }) => {
  test.setTimeout(8 * 60_000);

  await kiosk.step(`TOP UP: "${TOP_UP_HEADING}" asks who the customer is`, async () => {
    await kiosk.tap('TOP UP', { settleMs: 2500 });
    await kiosk.waitForText(TOP_UP_HEADING);
  });

  await kiosk.video?.pause();
  const before = await identifyByCode(kiosk);
  kiosk.video?.resume();

  await kiosk.step('The card and its balance are shown, with the amounts to choose (clubcard/getamounts)', async () => {
    await kiosk.waitForText(`Balance KWD ${before.balance.toFixed(3)}`);
    expect(await kiosk.hasText(`Wallet ${before.maskedCard}`), 'Masked wallet number').toBe(true);
    expect(await kiosk.hasTextContaining('Hello, '), 'Greeting').toBe(true);
    expect(await kiosk.hasText('Choose an amount. You pay by KNET, and the amount is added to your wallet.')).toBe(true);
    const amounts = await kiosk.waitForApiCall('clubcard/getamounts');
    const offered = (amounts.responseBody as { output: { amounts: { amount: number }[] } }).output.amounts.map((a) => a.amount);
    expect(offered, 'Amounts offered').toContain(AMOUNT);
    for (const a of offered) expect.soft(await kiosk.hasButton(`KWD ${a}`), `KWD ${a} button`).toBe(true);
    test.info().annotations.push({ type: 'balance before', description: `KWD ${before.balance.toFixed(3)}` });
  });

  const since = Date.now();
  await kiosk.step(`Choose KWD ${AMOUNT} and PAY by KNET (the fake terminal approves)`, async () => {
    // The button then reads "PAY KWD 10.000". On 8 Oct 2026 two taps in a row were lost, so up to three quick tries
    // (5 s each), well before "Are you still there?" (~30 s).
    await kiosk.tapUntil(`KWD ${AMOUNT}`, `PAY KWD ${AMOUNT.toFixed(3)}`, { settleMs: 800, timeout: 5_000, attempts: 3 });
    await tapPay(kiosk, AMOUNT);
  });

  await kiosk.step(`"KWD ${AMOUNT} was added to your club card."`, async () => {
    await expect.poll(() => kiosk.hasTextContaining('was added to your'), { message: 'Top-up confirmed on screen', timeout: 90_000 }).toBe(true);
    expect.soft(await kiosk.hasText('The new balance can take a few minutes to show in the app.'), 'Balance note').toBe(true);
    // Record what the top-up called (the KNET payment and the club card recharge), for the report.
    const calls = kiosk.apiCalls().filter((c) => c.time >= since && !c.path.startsWith('content/kioskLogs'));
    test.info().annotations.push({ type: 'top-up calls', description: calls.map((c) => `${c.path.split('?')[0]} ${(c.responseBody as { code?: number })?.code ?? c.status}`).join(', ') });
    const confirm = calls.find((c) => c.path.startsWith('payment/knet/kiosk/confirm'));
    if (confirm) expect.soft((confirm.responseBody as { output?: { PAID?: string } }).output?.PAID, 'KNET PAID').toBe('YES');
    test.info().annotations.push({ type: 'top-up', description: `KWD ${AMOUNT}.000 added to the test club card by KNET (fake terminal), balance before KWD ${before.balance.toFixed(3)}.` });
    // The success screen can show the new balance ("New balance KWD ..."); it may lag ("can take a few minutes").
    const newBalance = (await kiosk.texts()).find((t) => t.startsWith('New balance'));
    if (newBalance) {
      test.info().annotations.push({ type: 'balance after', description: newBalance });
      expect.soft(kwd(newBalance), 'New balance = before + top-up').toBeCloseTo(before.balance + AMOUNT, 3);
    }
  });
});
