// Settings shared by the helper scripts (the tests use src/config.ts, which reads the same .env values).
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(import.meta.dirname, '..', '.env'), quiet: true });

export const settings = {
  // The kiosk program to start.
  appPath: process.env.KIOSK_APP_PATH || 'C:\\ProgramData\\KNCC\\CinescapeKioskNew14\\CinescapeKiosk.exe',
  // Port the local Appium server listens on.
  appiumPort: Number(process.env.APPIUM_PORT || 4723),
};
