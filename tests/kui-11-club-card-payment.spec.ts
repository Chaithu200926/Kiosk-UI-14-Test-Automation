// KUI-11: paying with the club card (wallet) deducts exactly the amount paid from the customer's balance.
// The balance is read on the UAT website (My Account) before and after a KWD 0.500 food order on the kiosk.
// The order is recorded as a "paid booking" note.
import { test, expect } from '../src/fixtures';
import { addFood, CHEAP_FOOD } from '../src/flows';
import { payByWallet, skipUnlessWalletCode, successDetails } from '../src/payment';

// Skipped (before the kiosk starts) until a wallet code is configured: see WALLET_CODE_MISSING in src/payment.ts.
skipUnlessWalletCode();
import { clubCardBalance } from '../src/web-account';

test('KUI-11 Club card (wallet) payment deducts the balance', async ({ kiosk, config }) => {
  test.setTimeout(8 * 60_000);

  const before = (await test.step('Website: the customer\'s club card and its balance before paying', async () => {
    const b = await clubCardBalance();
    expect(b.cardNumber === config.customer.clubCard, 'The website account holds the club card used on the kiosk').toBe(true);
    test.info().annotations.push({ type: 'balance before', description: b.text });
    return b;
  }))!;
  expect(before.kwd, 'Enough balance for the order').toBeGreaterThanOrEqual(CHEAP_FOOD.price);

  await kiosk.step(`ORDER F&B: order "${CHEAP_FOOD.name}" and go to checkout`, async () => {
    await kiosk.tap('ORDER F&B', { settleMs: 2500 });
    await kiosk.waitForText('Select Food');
    await addFood(kiosk);
    await kiosk.tap('Proceed', { settleMs: 2500 });
    await kiosk.waitForText('Preview and Checkout');
  });

  const payment = await payByWallet(kiosk);

  await kiosk.step('"Booking Success!" shows the amount paid', async () => {
    await kiosk.waitForText('Booking Success!', 30_000);
    const d = await successDetails(kiosk);
    expect(d.reference, 'BOOKING ID = the confirmed booking').toBe(payment.reference);
    expect(d.totalPaid, 'Total paid').toBeCloseTo(CHEAP_FOOD.price, 3);
  });

  await test.step('Website: the balance went down by exactly the amount paid', async () => {
    // The website can take a moment to show the new balance, so check a few times.
    let after = before;
    for (let attempt = 1; attempt <= 4; attempt++) {
      after = await clubCardBalance();
      if (Math.abs(before.kwd - after.kwd - payment.amount) < 0.0005) break;
      await new Promise((r) => setTimeout(r, 20_000));
    }
    test.info().annotations.push({ type: 'balance after', description: after.text });
    expect(before.kwd - after.kwd, `Deducted (before ${before.text}, after ${after.text})`).toBeCloseTo(payment.amount, 3);
  });
});
