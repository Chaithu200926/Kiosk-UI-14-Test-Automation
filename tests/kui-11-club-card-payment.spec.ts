// KUI-11: paying from the wallet (club card) for a KWD 0.500 food order. After the code check (KIOSK_WALLET_CODE, 111111
// on UAT) build New14 shows the wallet balance, the order total and the balance after; the test checks them and the
// payment (clubcard/kiosk/pay). It asks for one code only: UAT refuses more than a few code requests in a short time
// ("Too many attempts"). Spends KWD 0.500 of the test club card per run; recorded as a "paid booking" note.
import { test, expect } from '../src/fixtures';
import { addFood, CHEAP_FOOD } from '../src/flows';
import { payByWallet, skipUnlessWalletCode, successDetails } from '../src/payment';

// Skipped (before the kiosk starts) unless the wallet code is set (KIOSK_WALLET_CODE, 111111 on UAT).
skipUnlessWalletCode();

test('KUI-11 Wallet payment: balance, order total and balance after; paid from the club card', async ({ kiosk }) => {
  test.setTimeout(8 * 60_000);

  await kiosk.step(`ORDER F&B: order "${CHEAP_FOOD.name}" and go to checkout`, async () => {
    await kiosk.tap('ORDER F&B', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    await addFood(kiosk);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
  });

  const payment = await payByWallet(kiosk);
  test.info().annotations.push({ type: 'balance before', description: `KWD ${payment.balanceBefore!.toFixed(3)}` });

  await kiosk.step('"Booking Success!" shows the amount paid', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    const d = await successDetails(kiosk);
    expect(d.reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    expect(d.totalPaid, 'Total paid').toBeCloseTo(CHEAP_FOOD.price, 3);
  });
  test.info().annotations.push({ type: 'balance after', description: `KWD ${(payment.balanceBefore! - payment.amount).toFixed(3)} (shown before paying)` });
});
