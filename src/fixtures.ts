// Test fixture: gives every test a freshly started kiosk, records it on video and cleans up afterwards.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test as base } from '@playwright/test';
import { config, type Config } from './config';
import { closeAllKiosks, desktopIsLocked } from './desktop';
import { HOME_MARKER, Kiosk } from './kiosk';
import { clearKioskData } from './kiosk-data';
import { ScreenVideo } from './video';

export const test = base.extend<{ kiosk: Kiosk; config: Config }>({
  config: async ({}, use) => {
    await use(config);
  },

  kiosk: async ({}, use, testInfo) => {
    if (desktopIsLocked()) {
      throw new Error('Windows is locked. UI tests need an unlocked, logged-in desktop: unlock the PC and run again.');
    }
    closeAllKiosks();
    // Start fresh: nothing the kiosk saved in earlier tests (payment journal, print archive, cached settings, paper
    // counter, screensaver media). A kiosk just closed can hold its files for a moment, so try a few times.
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
    const startedAt = Date.now();

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
    const kiosk = new Kiosk(app, testInfo, startedAt);
    const video = new ScreenVideo(testInfo.outputPath('kiosk.mp4'));
    kiosk.video = video;
    let kioskPid = '';

    try {
      // The home screen is ready when the main menu is shown (after the 5 s "Starting the kiosk" screen).
      await kiosk.waitForText(HOME_MARKER, 90_000);
      // The menu appears before the kiosk has finished loading its data, and taps in that moment are ignored.
      await kiosk.waitForText('UPCOMING SHOWS', 30_000);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // The kiosk window is the top element of the page source.
      const window = app.$('/*');
      kioskPid = (await window.getAttribute('ProcessId')) ?? '';
      // The kiosk draws in a portrait column (the "Root" panel) in the middle of the screen.
      const root = await app.$('~Root');
      const [rootPos, rootSize, screenSize] = [await root.getLocation(), await root.getSize(), await window.getSize()];
      kiosk.area = { x: Math.round(rootPos.x), y: 0, width: Math.round(rootSize.width), height: Math.round(screenSize.height) };
      if (!video.start(kiosk.area)) {
        testInfo.annotations.push({ type: 'video', description: `No video: ffmpeg.exe not found in ${config.ffmpegDir}` });
      }

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
      await kiosk.backToHome().catch(() => undefined);

      // Payment tests pause the video while the club card number or mobile is on screen, so there can be several parts.
      const files = await video.stop();
      for (const [i, file] of files.entries()) {
        await testInfo.attach(i ? `video (part ${i + 1})` : 'video', { path: file, contentType: 'video/mp4' });
      }
      await testInfo.attach('kiosk API calls', {
        body: JSON.stringify(kiosk.apiCalls().filter((c) => !c.path.startsWith('content/kioskLogs')), null, 2),
        contentType: 'application/json',
      });

      await app.deleteSession().catch(() => undefined);
      // Ending the Appium session does not close the kiosk, so close it (and its child process) here.
      if (kioskPid) {
        try {
          execFileSync('taskkill', ['/PID', kioskPid, '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* already closed */
        }
      } else {
        // The test stopped before the kiosk's process was known: close any kiosk.
        closeAllKiosks();
      }
    }
  },
});

export { expect } from '@playwright/test';
