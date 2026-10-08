// Every test starts the kiosk "fresh", like a private browser window: nothing the kiosk saved during earlier tests
// (payment journal, print archive, cached server settings, paper counter, downloaded posters, promos and screensaver
// media) is there when it starts. Kept: the chosen cinema and promo\ (the built-in banners from set-up, not downloaded).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

/** Kept: the cinema chosen at set-up (without it the kiosk asks for a cinema on start). */
const KEEP = new Set(['admin-choices.json']);

/**
 * Copies the kiosk's state folder to state-backup-<time> once per run, before anything is cleared:
 * the payment journal holds real UAT payment records.
 */
export function backupKioskState() {
  const state = path.join(config.kioskDataDir, 'state');
  if (!fs.existsSync(state)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = path.join(config.kioskDataDir, `state-backup-${stamp}`);
  fs.cpSync(state, backup, { recursive: true });
  return backup;
}

/**
 * Clears the kiosk's saved state and everything it downloaded: cache\ (film posters), remote-promo\ (promos from the
 * server) and saver\ (screensaver media). The kiosk must be closed. Returns the names removed.
 */
export function clearKioskData(): string[] {
  const removed: string[] = [];
  for (const sub of ['state', 'cache', 'remote-promo', 'saver']) {
    const dir = path.join(config.kioskDataDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (sub === 'state' && KEEP.has(name)) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed.push(`${sub}/${name}`);
    }
  }
  return removed;
}
