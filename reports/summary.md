## Cinescape kiosk UI tests: 22/24 passed, 2 skipped

**Run** #local · **commit** `9859b47` Keep the kiosk open between tests: home, English and no-popup check before each test, fresh start after a failure; .env path set in the workflows · **by** Chaithu200926 · **trigger** published from QA PC  
**App** CinescapeKiosk build CinescapeKioskNew17 · UAT API · **Driver** CinescapeKiosk (Appium NovaWindows) · **Node** v24.21.0 · **Playwright** 1.63.0 · **Duration** 1800.57s  
**Pass-rate trend** (oldest → newest): 88% → 92% → 92% → 92%  
**Dashboard (screenshots & videos):** https://chaithu200926.github.io/Kiosk-UI-14-Test-Automation/

| Test | Result | Duration | Steps | Last 10 runs | Failure |
|---|---|---|---|---|---|
| KUI-01 App start: the home screen loads with all menu buttons | ✅ Passed | 27.13s | 5 | ✅✅✅✅ |  |
| KUI-02 Language switch: Arabic translates and mirrors the screens, HOME returns to English | ✅ Passed | 32.94s | 6 | ✅✅✅✅ |  |
| KUI-03 Films and show times match today's programme | ✅ Passed | 31.37s | 5 | ✅✅✅✅ |  |
| KUI-04 Coming soon: films show opening dates and details, not on sale yet | ✅ Passed | 21.21s | 4 | ✅✅✅✅ |  |
| KUI-05 Seat category, seat type and ticket quantity: total = price x quantity | ✅ Passed | 31.61s | 11 | ▫️✅✅✅ |  |
| KUI-06 Seat selection: unavailable seats are blocked and Proceed needs every seat | ✅ Passed | 113.52s | 10 | ✅✅✅✅ |  |
| KUI-07 Ticket purchase end to end, paid by KNET | ✅ Passed | 139.38s | 12 | ▫️✅✅✅ |  |
| KUI-16 Pickup tickets by BOOKING ID; a second pickup is refused | ✅ Passed | 52.55s | 3 | ✅✅✅✅ |  |
| KUI-08 Food purchase end to end, paid by KNET | ✅ Passed | 112.26s | 7 | ▫️✅✅✅ |  |
| KUI-09 Food combo options carry through to checkout | ✅ Passed | 68.17s | 11 | ✅✅✅✅ |  |
| KUI-10 Tickets and food in one order, paid once by KNET | ✅ Passed | 142.56s | 13 | ▫️✅✅✅ |  |
| KUI-11 Wallet payment: balance, order total and balance after; paid from the club card | ✅ Passed | 81.08s | 7 | ▫️✅✅✅ |  |
| KUI-14 Cancel during booking releases the reserved seats | ✅ Passed | 117.10s | 11 | ✅✅✅✅ |  |
| KUI-15 Idle timeout: the kiosk returns home and releases held seats | ✅ Passed | 191.70s | 11 | ✅✅✅✅ |  |
| KUI-17 Email my tickets after a purchase | ⏭️ Skipped | 0.00s | 0 | ❌⏭️⏭️⏭️ |  |
| KUI-20 Top up the club card with KWD 10 by KNET | ✅ Passed | 98.96s | 6 | ▫️✅✅✅ |  |
| KUI-21 Printer out of paper: clear message, nothing printed | ⏭️ Skipped | 0.00s | 0 | ⏭️⏭️⏭️⏭️ |  |
| KUI-23 API unavailable: friendly messages, no crash, recovers when the API is back | ✅ Passed | 63.94s | 6 | ✅✅✅✅ |  |
| KUI-24 Advance booking: films, details and show times; a show opens the seat category screen | ✅ Passed | 36.23s | 5 | ▫️✅✅✅ |  |
| KUI-25 Upcoming shows: the experience filter shows only that experience | ✅ Passed | 29.13s | 5 | ▫️✅✅✅ |  |
| KUI-26 Wallet code: SEND CODE emails a code, a wrong code is refused | ✅ Passed | 124.38s | 5 | ▫️✅✅✅ |  |
| KUI-27 Help button: staff are alerted and the customer is told to wait | ✅ Passed | 19.56s | 3 | ▫️✅✅✅ |  |
| KUI-28 Prepare food: the booking ID screen refuses an unknown booking | ✅ Passed | 32.63s | 3 | ▫️✅✅✅ |  |
| KUI-29 Checkout: country code picker and the payment methods | ✅ Passed | 225.96s | 10 | ▫️✅✅✅ |  |
