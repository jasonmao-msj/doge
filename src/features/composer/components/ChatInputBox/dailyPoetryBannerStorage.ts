import { getClientStoreSync, writeClientStoreValue } from '../../../../services/clientStorage';
import {
  createDailyPoetryBannerSnapshot,
  getLocalDateKey,
  type DailyPoetryBannerSnapshot,
} from './utils/dailyPoetry.js';

const DAILY_POETRY_BANNER_DISMISSED_DATE_KEY = 'composer.dailyPoetryBannerDismissedDate';

export function readDailyPoetryBannerSnapshot(
  date: Date = new Date(),
): DailyPoetryBannerSnapshot {
  return createDailyPoetryBannerSnapshot(
    date,
    getClientStoreSync('app', DAILY_POETRY_BANNER_DISMISSED_DATE_KEY),
  );
}

export function dismissDailyPoetryBannerForDate(date: Date = new Date()): void {
  writeClientStoreValue(
    'app',
    DAILY_POETRY_BANNER_DISMISSED_DATE_KEY,
    getLocalDateKey(date),
  );
}
