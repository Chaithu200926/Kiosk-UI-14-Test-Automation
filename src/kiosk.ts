// The kiosk as the tests see it: tap buttons by their visible text, wait for texts, read seats,
// and take screenshots of the kiosk area. Wraps the Appium (NovaWindows) session.
import fs from 'node:fs';
import { test, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { remote } from 'webdriverio' with { 'resolution-mode': 'import' };
import { outageSwitch, readRecordedCalls, type RecordedCall } from './api-recorder';
import { config, hidePrivate, privateValues } from './config';
import type { ScreenArea, ScreenVideo } from './video';

export type KioskSession = Awaited<ReturnType<typeof remote>>;
export type SeatState = 'available' | 'unavailable' | 'selected';
export type Seat = { row: string; number: string; x: number; y: number; width: number; height: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** The big home button (build New14; it was NOW SHOWING before). Its text marks the home screen. */
export const HOME_MARKER = 'BUY TICKETS';
// XPath string literal that works whatever quotes the text contains.
const lit = (text: string) => (text.includes('"') ? `'${text}'` : `"${text}"`);

export class Kiosk {
  /** The part of the screen the kiosk draws on (set once the home screen is up). */
  area: ScreenArea = { x: 0, y: 0, width: 1920, height: 1200 };
  /** The test video (set by the fixture); paused while the club card number or mobile is on screen. */
  video?: ScreenVideo;
  /**
   * Set once a test has typed the mobile or club card number: from then on screenshots black out any text
   * showing them and the failure layout hides them (the report is public).
   */
  privateOnScreen = false;
  private shot = 0;

  constructor(readonly app: KioskSession, private readonly testInfo: TestInfo, private readonly startedAt: number) {}

  // ---------- finding things ----------

  /**
   * All buttons with this label: first those whose own name is the label (most kiosk buttons; the quickest search),
   * otherwise those whose inner text is the label. (The driver's XPath has no "or" / grouping support.)
   * On a big seat map (build New15) a search that looks inside every button takes many seconds.
   */
  async buttons(label: string) {
    const byName = await this.app.$$(`//Button[@Name=${lit(label)}]`).getElements();
    if (byName.length) return byName;
    const byText = await this.app.$$(`//Button[.//Text[@Name=${lit(label)}]]`).getElements();
    if (byText.length) return byText;
    // Build New14 home tiles are list items named "HomeTile { Key = topup, Text = TOP UP, ... }"; their inner
    // button and text are not always exposed to UI Automation, so the tile itself is tapped then.
    return this.app.$$(`//DataItem[contains(@Name, ${lit(`Text = ${label},`)})]`).getElements();
  }

  async hasButton(label: string) {
    return (await this.buttons(label)).length > 0;
  }

  /** Waits for the nth button with this label and returns it. */
  async button(label: string, nth = 1, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = await this.buttons(label);
      if (found.length >= nth) return found[nth - 1];
      if (Date.now() > deadline) throw new Error(`Button "${label}"${nth > 1 ? ` #${nth}` : ''} was not found within ${timeout / 1000} s`);
      await sleep(500);
    }
  }

  text(label: string) {
    return this.app.$(`//Text[@Name=${lit(label)}]`);
  }

  /** First text that starts with `prefix`, e.g. "Total Ticket Price". */
  async textStartingWith(prefix: string, timeout = 10_000): Promise<string> {
    const el = this.app.$(`//Text[starts-with(@Name, ${lit(prefix)})]`);
    await el.waitForExist({ timeout, timeoutMsg: `No text starting with "${prefix}" within ${timeout / 1000} s` });
    return (await el.getAttribute('Name')) ?? '';
  }

  async waitForText(label: string, timeout = 20_000) {
    await this.text(label).waitForExist({ timeout, timeoutMsg: `"${label}" did not appear within ${timeout / 1000} s` });
  }

  async hasText(label: string) {
    return this.text(label).isExisting();
  }

  /** True when some text on the screen contains `part`, e.g. an email address shown as "name@domain". */
  async hasTextContaining(part: string) {
    return this.app.$(`//Text[contains(@Name, ${lit(part)})]`).isExisting();
  }

  /** Texts drawn inside the visible part of the kiosk screen (not scrolled out of view), with their position. */
  async visibleTexts(): Promise<{ name: string; y: number }[]> {
    const xml = await this.app.getPageSource();
    const bottom = this.area.y + this.area.height - 120; // leave out the bottom button bar
    return [...xml.matchAll(/<Text\b[^>]*?\bName="([^"]*)"[^>]*>/g)]
      .map(([tag, name]) => ({ name: decodeXml(name), y: Number((tag.match(/\by="(-?\d+)"/) || [])[1]), off: /IsOffscreen="True"/.test(tag) }))
      .filter((t) => t.name && !t.off && t.y > 120 && t.y < bottom)
      .map(({ name, y }) => ({ name, y }));
  }

  /** All visible texts on the current screen, in screen order. */
  async texts(): Promise<string[]> {
    const xml = await this.app.getPageSource();
    return [...xml.matchAll(/<Text\b[^>]*?\bName="([^"]*)"[^>]*>/g)]
      .filter(([tag]) => !/IsOffscreen="True"/.test(tag))
      .map(([, name]) => decodeXml(name))
      .filter(Boolean);
  }

  // ---------- acting ----------

  /**
   * Taps the button with this label until `text` appears. Build New15 loses a tap now and then (the screen does not
   * change), so it taps again (up to `attempts` taps in all) when the text has not appeared after `timeout`.
   */
  async tapUntil(label: string, text: string, options: { timeout?: number; settleMs?: number; attempts?: number } = {}) {
    const timeout = options.timeout ?? 12_000;
    const attempts = options.attempts ?? 2;
    await this.tap(label, { settleMs: options.settleMs });
    for (let attempt = 2; ; attempt++) {
      try {
        return await this.waitForText(text, timeout);
      } catch (e) {
        if (attempt > attempts) throw e;
        if (await this.hasButton(label)) await this.tap(label, { settleMs: options.settleMs });
      }
    }
  }

  /** Taps the button with this label and gives the screen a moment to change. */
  async tap(label: string, options: { nth?: number; timeout?: number; settleMs?: number } = {}) {
    const el = await this.button(label, options.nth, options.timeout);
    await el.click();
    await sleep(options.settleMs ?? 800);
  }

  /**
   * Taps − or + next to "Ticket Quantity". On build New14 they are icon buttons without a name; keep the
   * selection tied to the quantity row instead of guessing by the count of empty-name buttons on the page.
   */
  async tapQuantity(sign: '+' | '−') {
    const row = await this.text('Ticket Quantity').getLocation();
    const inRow: { el: { click(): Promise<unknown> }; x: number }[] = [];
    for (const el of await this.app.$$('//Button[@Name=""]').getElements()) {
      const [pos, size] = [await el.getLocation(), await el.getSize()];
      const centerY = pos.y + size.height / 2;
      const centerX = pos.x + size.width / 2;
      if (Math.abs(centerY - (row.y + 10)) < 30 && centerX > row.x + 100) inRow.push({ el, x: centerX });
    }
    if (!inRow.length) throw new Error(`The ${sign} button next to Ticket Quantity was not found`);
    inRow.sort((a, b) => a.x - b.x);
    if (sign === '−' && inRow.length < 2) throw new Error(`The ${sign} button next to Ticket Quantity was not found`);
    await (sign === '+' ? inRow[inRow.length - 1] : inRow[0]).el.click();
    await sleep(600);
  }

  async isEnabled(label: string) {
    const el = await this.button(label);
    return (await el.getAttribute('IsEnabled')) === 'True';
  }

  /**
   * Types digits on the on-screen keypad one at a time. Fast taps are sometimes dropped by the kiosk,
   * so after typing it checks the displayed value and retries once. `shownAs: null` skips the check
   * (e.g. a code typed into one box per digit).
   */
  async typeDigits(digits: string, shownAs: string | null = digits) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      for (const d of digits) await this.tap(d, { settleMs: 350 });
      if (shownAs === null || await this.hasText(shownAs)) return;
      for (let i = 0; i < digits.length + 2; i++) await this.tap('⌫', { settleMs: 200 });
    }
    throw new Error(`The keypad did not show "${hidePrivate(shownAs ?? '')}" after typing it twice`);
  }

  /**
   * Types on the email keyboard (lower-case letters, digits, "." "_" "-") one key at a time. The typed value can be
   * shown inside a longer text (e.g. "@" + domain), so it checks that some text contains it; ⌫ and retry once.
   */
  async typeText(text: string) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      for (const ch of text) await this.tap(ch, { settleMs: 350 });
      if (await this.hasTextContaining(text)) return;
      for (let i = 0; i < text.length + 2; i++) await this.tap('⌫', { settleMs: 200 });
    }
    throw new Error(`The keyboard did not show "${hidePrivate(text)}" after typing it twice`);
  }

  /** Types letters and digits on the booking ID keyboard (its keys are upper case); CLEAR and retry once if a tap was lost. */
  async typeKeys(text: string) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      for (const ch of text) await this.tap(ch, { settleMs: 400 });
      if (await this.hasText(text)) return;
      await this.tap('CLEAR', { settleMs: 500 });
    }
    throw new Error(`The keyboard did not show "${text}" after typing it twice`);
  }

  // ---------- seats ----------

  seat(row: string, number: string | number) {
    return this.app.$(`//DataItem[contains(@Name, ${lit(`Name = ${row},`)})]//Button[@AutomationId="Place"][.//Text[@Name=${lit(String(number))}]]`);
  }

  /**
   * Taps a seat by its label, e.g. "K27". On build New15 every search on a big seat map takes seconds, and the kiosk
   * asks "Are you still there?" after about half a minute untouched, so seat work keeps the searches few.
   */
  async tapSeat(label: string) {
    const seat = this.seat(label.slice(0, 1), label.slice(1));
    await seat.waitForExist({ timeout: 10_000, timeoutMsg: `Seat ${label} was not found on the seat map within 10 s` });
    await seat.click();
  }

  /** Answers "Are you still there?" with YES, I'M HERE when it shows (checked by its text: the quickest search). */
  async stillHere() {
    if (!(await this.hasText('Are you still there?'))) return;
    // The prompt can close between the check and the tap.
    await this.tap("YES, I'M HERE", { timeout: 2_000, settleMs: 1000 }).catch(() => undefined);
  }

  /**
   * Every seat on the map with its row, number and position on the screen. Build New15 draws the map after the
   * "Select Seat" heading, so a read can find no seats yet: read again until it finds some.
   */
  async seats(timeout = 10_000): Promise<Seat[]> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const seats = await this.readSeats();
      if (seats.length || Date.now() > deadline) return seats;
      await sleep(500);
    }
  }

  private async readSeats() {
    let xml = await this.app.getPageSource();
    // "Are you still there?" covers the map (found in the page already read, no extra search): answer it, read again.
    if (xml.includes('Are you still there?')) {
      await this.tap("YES, I'M HERE", { timeout: 2_000, settleMs: 1000 }).catch(() => undefined);
      xml = await this.app.getPageSource();
    }
    const attr = (tag: string, key: string) => (tag.match(new RegExp(`\\b${key}="([^"]*)"`)) || [])[1] ?? '';
    const result: Seat[] = [];
    // Walk the tags in order: a row marker sets the current row; a seat button is followed by its number text.
    let row = '';
    let pending: { x: number; y: number; width: number; height: number } | undefined;
    for (const [tag] of xml.matchAll(/<(DataItem|Button|Text)\b[^>]*>/g)) {
      const rowName = tag.match(/Name="SeatRowView \{ Name = (\w+),/);
      if (rowName) { row = rowName[1]; continue; }
      if (tag.startsWith('<Button') && attr(tag, 'AutomationId') === 'Place') {
        pending = { x: +attr(tag, 'x'), y: +attr(tag, 'y'), width: +attr(tag, 'width'), height: +attr(tag, 'height') };
      } else if (pending && tag.startsWith('<Text') && attr(tag, 'AutomationId') === 'Number') {
        result.push({ row, number: attr(tag, 'Name'), ...pending });
        pending = undefined;
      }
    }
    return result;
  }

  /**
   * Seat states from the screen colours (the kiosk exposes no state attribute):
   * white = available, dark grey = unavailable, red = selected.
   */
  async seatStates(seats?: Seat[]): Promise<Map<string, SeatState>> {
    // Seats first (or the ones just read): they wait for the map to be drawn, so the screenshot shows the whole map.
    seats ??= await this.seats();
    // Build New15 draws every seat white first and greys out the unavailable ones a moment later: read the colours
    // until two screenshots in a row agree.
    let last = '';
    for (let attempt = 1; ; attempt++) {
      const states = await this.seatColours(seats);
      const key = [...states.values()].join();
      if (key === last || attempt === 6) return states;
      last = key;
      await sleep(700);
    }
  }

  /** Seat states from one screenshot (about 0.1 s, against seconds for any search on a big seat map). */
  async seatColours(seats: Seat[]): Promise<Map<string, SeatState>> {
    const png = PNG.sync.read(Buffer.from(await this.app.takeScreenshot(), 'base64'));
    const states = new Map<string, SeatState>();
    for (const s of seats) {
      // Sample the seat cushion, below the number label.
      const px = Math.round(s.x + s.width / 2);
      let [r, g, b] = [0, 0, 0];
      for (let dy = Math.round(s.height * 0.6); dy < s.height - 2; dy++) {
        const i = (png.width * (s.y + dy) + px) << 2;
        r = Math.max(r, png.data[i]); g = Math.max(g, png.data[i + 1]); b = Math.max(b, png.data[i + 2]);
      }
      const state: SeatState = r > 170 && g < 110 ? 'selected' : r > 170 && g > 170 && b > 170 ? 'available' : 'unavailable';
      states.set(`${s.row}${s.number}`, state);
    }
    return states;
  }

  // ---------- evidence ----------

  /** Screenshot of the kiosk area only (the rest of the screen is black). */
  async screenshot(): Promise<Buffer> {
    // The screen can change while the screenshot is taken (e.g. the kiosk times out to the home screen), so private
    // values are looked up both before and after it, and every place either lookup found is blacked out.
    const before = this.privateOnScreen ? await this.privateAreas() : [];
    const full = PNG.sync.read(Buffer.from(await this.app.takeScreenshot(), 'base64'));
    if (this.privateOnScreen) blackOut(full, [...before, ...(await this.privateAreas())]);
    const { x, y, width, height } = this.area;
    const w = Math.min(width, full.width - x);
    const h = Math.min(height, full.height - y);
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(full, out, x, y, w, h, 0, 0);
    return PNG.sync.write(out);
  }

  /** Screen areas of every control whose text contains the club card number, mobile or email. */
  private async privateAreas(): Promise<ScreenArea[]> {
    const areas: ScreenArea[] = [];
    for (const value of privateValues()) {
      for (const el of await this.app.$$(`//*[contains(@Name, ${lit(value)})]`).getElements()) {
        const [pos, size] = [await el.getLocation(), await el.getSize()];
        areas.push({ x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(size.width), height: Math.round(size.height) });
      }
    }
    return areas;
  }

  /** The screen layout for the report, with the private values hidden. */
  async layout(): Promise<string> {
    return hidePrivate(await this.app.getPageSource());
  }

  /** A named step in the report, with a screenshot taken when the step's actions are done. */
  async step<T>(label: string, body?: () => Promise<T>): Promise<T | undefined> {
    return test.step(label, async () => {
      const value = body ? await body() : undefined;
      this.shot += 1;
      await this.testInfo.attach(`${String(this.shot).padStart(2, '0')} ${label}`, { body: await this.screenshot(), contentType: 'image/png' });
      return value;
    });
  }

  /** Simulates the UAT API being down (every kiosk API call gets HTTP 503) until switched off again. */
  apiOutage(on: boolean) {
    const file = outageSwitch(config.apiCallsFile);
    if (on) fs.writeFileSync(file, 'on');
    else fs.rmSync(file, { force: true });
  }

  /** Kiosk API calls made since this test started (from the recorder). */
  apiCalls(): RecordedCall[] {
    return readRecordedCalls(config.apiCallsFile, this.startedAt);
  }

  /** Waits until the kiosk has made a call whose path starts with `path`, and returns the latest one. */
  async waitForApiCall(path: string, since = this.startedAt, timeout = 20_000): Promise<RecordedCall> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const call = readRecordedCalls(config.apiCallsFile, since).filter((c) => c.path.startsWith(path)).pop();
      if (call) return call;
      await sleep(500);
    }
    throw new Error(`The kiosk did not call ${path} within ${timeout / 1000} s`);
  }

  /** Presses Cancel / HOME until the home screen is back (used to leave a booking cleanly). */
  /**
   * Closes an open food item sheet with its ✕. On build New15 the ✕ is an unnamed icon button, the only small one
   * in the right half of the screen (option tiles are over 100 px wide; − and + are named).
   */
  async closeSheet() {
    const middle = this.area.x + this.area.width / 2;
    for (const el of await this.app.$$('//Button[@Name=""]').getElements()) {
      const [pos, size] = [await el.getLocation(), await el.getSize()];
      if (size.width < 70 && size.height < 70 && pos.x > middle) {
        await el.click();
        await sleep(1500);
        return;
      }
    }
    throw new Error('The ✕ of the item sheet was not found');
  }

  async backToHome(maxPresses = 8) {
    for (let i = 0; i < maxPresses; i++) {
      if (await this.hasText(HOME_MARKER) && await this.hasText('UPCOMING SHOWS')) return;
      if (await this.hasButton('Done')) await this.closeSheet();
      else if (await this.hasButton('HOME')) await this.tap('HOME', { settleMs: 1500 });
      else if (await this.hasButton('Cancel')) await this.tap('Cancel', { settleMs: 1500 });
      else if (await this.hasButton('Back')) await this.tap('Back', { settleMs: 1500 });
      else break;
    }
    if (!(await this.hasText(HOME_MARKER))) throw new Error('Could not return to the home screen');
  }
}

/** Paints dark grey over the given screen areas (with a small margin). */
function blackOut(png: PNG, areas: ScreenArea[]) {
  for (const a of areas) {
    const x0 = Math.max(0, a.x - 4), y0 = Math.max(0, a.y - 4);
    const x1 = Math.min(png.width, a.x + a.width + 4), y1 = Math.min(png.height, a.y + a.height + 4);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (png.width * yy + xx) << 2;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 40;
      }
    }
  }
}

function decodeXml(text: string) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
