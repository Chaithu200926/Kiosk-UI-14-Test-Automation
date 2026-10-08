// Settings for the kiosk UI tests, read from the local .env file (never committed).
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const appPath = process.env.KIOSK_APP_PATH || 'C:\\ProgramData\\KNCC\\CinescapeKisokNew15\\CinescapeKiosk.exe';

export const config = {
  /* The kiosk program the tests start, and the settings file it reads (for the API address and key). */
  appPath,
  /* Build under test = the app's folder name, e.g. "CinescapeKioskNew13". */
  build: path.basename(path.dirname(appPath)),
  settingsPath: process.env.KIOSK_SETTINGS_PATH || path.join(path.dirname(appPath), 'kiosk.settings.json'),

  /* Local helper servers. */
  appiumPort: Number(process.env.APPIUM_PORT || 4723),
  recorderPort: Number(process.env.KIOSK_RECORDER_PORT || 8899),
  /* Where the recorder writes the kiosk's API calls during a run. */
  apiCallsFile: path.resolve(__dirname, '..', 'test-results', 'kiosk-api-calls.jsonl'),

  /* Mobile number typed on the checkout keypad. */
  mobile: process.env.KIOSK_TEST_MOBILE || '',
  /* Test customer for sign-in, wallet and top-up tests. */
  customer: {
    username: process.env.KIOSK_TEST_USERNAME || '',
    password: process.env.KIOSK_TEST_PASSWORD || '',
    otp: process.env.KIOSK_TEST_OTP || '',
    /* Club card (wallet) number, typed to identify the customer when paying from the wallet. */
    clubCard: process.env.KIOSK_TEST_CLUB_CARD || '',
    /* Code that confirms the wallet customer (build New14 emails one; UAT needs a fixed code for the test customer). */
    walletCode: process.env.KIOSK_WALLET_CODE || '',
    /* Address KUI-17 emails the tickets to (default: the customer's login email). */
    ticketsEmail: process.env.KIOSK_TEST_EMAIL || process.env.KIOSK_TEST_USERNAME || '',
  },
  /* UAT website, where KUI-11 reads the club card balance (My Account). */
  webUrl: process.env.KIOSK_WEB_URL || 'https://uatweb.cinescape.com.kw',
  /*
   * Where the kiosk keeps its data between starts (every build uses the same folder): state\ (payment journal, print
   * archive, cached server settings, paper counter, chosen cinema), saver\ (screensaver media) and logs\.
   * Each test starts with this folder cleared (src/kiosk-data.ts).
   */
  kioskDataDir: process.env.KIOSK_DATA_DIR || 'C:\\ProgramData\\KNCC\\CinescapeKioskNew',
  /* The kiosk's paper counter (roll length and paper used); KUI-21 marks the roll used up to simulate "out of paper". */
  paperRollFile: process.env.KIOSK_PAPER_ROLL_FILE || path.join(process.env.KIOSK_DATA_DIR || 'C:\\ProgramData\\KNCC\\CinescapeKioskNew', 'state', 'paper-roll.json'),
  /* Admin PIN of this test kiosk (the settings file only holds its hash). */
  adminPin: process.env.KIOSK_ADMIN_PIN || '',

  /* Video: folder holding ffmpeg.exe and the frame rate. */
  ffmpegDir: process.env.FFMPEG_DIR || path.join(localAppData, 'ffmpeg', 'bin'),
  videoFps: Number(process.env.KIOSK_VIDEO_FPS || 10),
};

export type Config = typeof config;

/**
 * Values that must never appear in the public report: the club card number, the mobile number on it
 * and the customer's emails. Screenshots, videos, API call records and error messages hide them.
 * The kiosk's email keyboard is lower case, and KUI-17 shows the part before the @ on its own, so those count too.
 */
export function privateValues(): string[] {
  const emails = [config.customer.username, config.customer.ticketsEmail].flatMap((e) => [e, e.toLowerCase(), e.split('@')[0].toLowerCase()]);
  return [...new Set([config.customer.clubCard, config.mobile, config.customer.walletCode, ...emails])].filter((v) => v.length >= 6);
}

/** Replaces every private value in a text with "***". */
export function hidePrivate(text: string): string {
  return privateValues().reduce((t, v) => t.split(v).join('***'), text);
}
