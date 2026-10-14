// Test fixture: opens the kiosk once and keeps it open between tests. Before each test it checks the kiosk is
// still running, on the home screen, in English and without a popup; if not, or if the previous test failed, the
// kiosk is closed and started fresh (saved data cleared). Each test is recorded on video.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test as base, type TestInfo } from '@playwright/test';
import { config, type Config } from './config';
import { closeAllKiosks, desktopIsLocked } from './desktop';
import { HOME_MARKER, Kiosk, type KioskSession } from './kiosk';
import { clearKioskData } from './kiosk-data';
import { ScreenVideo } from './video';

/** The open kiosk app, shared by the tests of one worker (there is one worker). */
interface OpenKiosk {
  app: KioskSession;
  pid: string;
  launchedAt: number;
  area: Kiosk['area'];
}

let open: OpenKiosk | undefined;

/** Ends the Appium session and closes the kiosk (and its child process). */
async function closeKiosk() {
  const current = open;
  open = undefined;
  if (!current) {
    closeAllKiosks();
    return;
  }
  await current.app.deleteSession().catch(() => undefined);
  // Ending the Appium session does not close the kiosk, so close it here.
  if (current.pid) {
    try {
      execFileSync('taskkill', ['/PID', current.pid, '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already closed */
    }
  } else {
    closeAllKiosks();
  }
}

function isRunning(pid: string) {
  try {
    return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).includes(pid);
  } catch {
    return false;
  }
}

/** Closes any kiosk, clears what it saved, and opens it through Appium until the home screen is ready. */
async function startFresh(testInfo: TestInfo): Promise<OpenKiosk> {
  await closeKiosk();
  // Nothing the kiosk saved in earlier runs (payment journal, print archive, cached settings, paper counter,
  // screensaver media). A kiosk just closed can hold its files for a moment, so try a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      const removed = clearKioskData();
      testInfo.annotations.push({ type: 'fresh start', description: removed.length ? `Cleared before start: ${removed.join(', ')}` : 'Nothing to clear' });
      break;
    } catch (e) {
      if (attempt === 5) throw new Error(`Could not clear the kiosk's saved data in ${config.kioskDataDir}: ${e}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const launchedAt = Date.now();

  // Start the kiosk through Appium. It inherits HTTP_PROXY, so its API calls go through the recorder.
  const { remote } = await import('webdriverio');
  // NovaWindows driver options (appWorkingDir is not in WebdriverIO's built-in types).
  const capabilities = {
    platformName: 'Windows',
    'appium:automationName': 'NovaWindows',
    'appium:app': config.appPath,
    'appium:appWorkingDir': path.dirname(config.appPath),
    'appium:newCommandTimeout': 600,
  };
  const app = await remote({ hostname: '127.0.0.1', port: config.appiumPort, logLevel: 'warn', connectionRetryTimeout: 180_000, capabilities });
  open = { app, pid: '', launchedAt, area: { x: 0, y: 0, width: 1920, height: 1200 } };
  const kiosk = new Kiosk(app, testInfo, launchedAt);

  // The home screen is ready when the main menu is shown (after the 5 s "Starting the kiosk" screen).
  await kiosk.waitForText(HOME_MARKER, 90_000);
  // The menu appears before the kiosk has finished loading its data, and taps in that moment are ignored.
  await kiosk.waitForText('UPCOMING SHOWS', 30_000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  // The kiosk window is the top element of the page source.
  const window = app.$('/*');
  open.pid = (await window.getAttribute('ProcessId')) ?? '';
  // The kiosk draws in a portrait column (the "Root" panel) in the middle of the screen.
  const root = await app.$('~Root');
  const [rootPos, rootSize, screenSize] = [await root.getLocation(), await root.getSize(), await window.getSize()];
  open.area = { x: Math.round(rootPos.x), y: 0, width: Math.round(rootSize.width), height: Math.round(screenSize.height) };
  return open;
}

/**
 * Checks the open kiosk can be used for the next test: still running, and back on the home screen in English
 * with no popup. Returns why it cannot, or undefined when it is ready.
 */
async function notReady(current: OpenKiosk, testInfo: TestInfo): Promise<string | undefined> {
  if (current.pid && !isRunning(current.pid)) return 'the kiosk app had closed';
  const kiosk = new Kiosk(current.app, testInfo, Date.now(), current.launchedAt);
  kiosk.area = current.area;
  try {
    await kiosk.backToHome();
    if (!(await kiosk.hasText('UPCOMING SHOWS'))) return 'the home screen was not complete';
    // The Arabic switch only shows while the kiosk is in English.
    if (!(await kiosk.hasButton('عربي'))) return 'the kiosk was not in English';
    if (await kiosk.hasText('Are you still there?')) return '"Are you still there?" did not close';
    // Appium brings the kiosk to the front only when it opens it. Taps on a kiosk that is not the active window are
    // lost (14 Oct 2026: every tap of KUI-02 and KUI-05 on a reused kiosk), so bring it to the front again.
    await current.app.execute('windows: setFocus', await current.app.$('/*'));
    // As after a fresh start: taps just after the home screen (re)loads are ignored.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (e) {
    return `it could not get back to the home screen (${(e as Error).message.split('\n')[0]})`;
  }
  return undefined;
}

export const test = base.extend<{ kiosk: Kiosk; config: Config; freshKiosk: boolean }, { kioskCleanup: void }>({
  config: async ({}, use) => {
    await use(config);
  },

  /** Set with test.use({ freshKiosk: true }) for a test that must start the kiosk itself (KUI-01). */
  freshKiosk: [false, { option: true }],

  /** Closes the kiosk when the worker ends (end of the run, or after a failed test). */
  kioskCleanup: [async ({}, use) => {
    await use();
    await closeKiosk();
  }, { scope: 'worker', auto: true }],

  kiosk: async ({ freshKiosk }, use, testInfo) => {
    if (desktopIsLocked()) {
      throw new Error('Windows is locked. UI tests need an unlocked, logged-in desktop: unlock the PC and run again.');
    }
    const startedAt = Date.now();

    // Reuse the open kiosk when it is ready; otherwise start it fresh.
    const reason = !open ? 'no kiosk open yet (first test, or Playwright started a new test process)' : freshKiosk ? 'this test starts the kiosk itself' : await notReady(open, testInfo);
    let current: OpenKiosk;
    if (reason) {
      current = await startFresh(testInfo);
    } else {
      current = open!;
      testInfo.annotations.push({ type: 'kiosk', description: 'Reused the open kiosk: back on the home screen, in English, no popup' });
    }
    if (reason) testInfo.annotations.push({ type: 'kiosk', description: `Started fresh: ${reason}` });

    const kiosk = new Kiosk(current.app, testInfo, startedAt, current.launchedAt);
    kiosk.area = current.area;
    const video = new ScreenVideo(testInfo.outputPath('kiosk.mp4'));
    kiosk.video = video;
    if (!video.start(kiosk.area)) {
      testInfo.annotations.push({ type: 'video', description: `No video: ffmpeg.exe not found in ${config.ffmpegDir}` });
    }

    try {
      await use(kiosk);
    } finally {
      // Never leave a simulated API outage switched on.
      kiosk.apiOutage(false);
      const failed = testInfo.status !== testInfo.expectedStatus;
      await testInfo.attach('final screen', { body: await kiosk.screenshot(), contentType: 'image/png' }).catch(() => undefined);
      if (failed) {
        // The screen layout helps fix a locator when a test fails.
        await testInfo.attach('screen layout (on failure)', { body: await kiosk.layout(), contentType: 'application/xml' })
          .catch(() => undefined);
      }
      // Leave any booking the kiosk still holds, so its seats are released (the kiosk sends content/trans/cancel).
      const home = await kiosk.backToHome().then(() => true, () => false);

      // Payment tests pause the video while the club card number or mobile is on screen, so there can be several parts.
      const files = await video.stop();
      for (const [i, file] of files.entries()) {
        await testInfo.attach(i ? `video (part ${i + 1})` : 'video', { path: file, contentType: 'video/mp4' });
      }
      await testInfo.attach('kiosk API calls', {
        body: JSON.stringify(kiosk.apiCalls().filter((c) => !c.path.startsWith('content/kioskLogs')), null, 2),
        contentType: 'application/json',
      });

      // After a failure the kiosk's state is unknown: close it, so the next test starts it fresh.
      if (failed || !home) await closeKiosk();
    }
  },
});

export { expect } from '@playwright/test';
