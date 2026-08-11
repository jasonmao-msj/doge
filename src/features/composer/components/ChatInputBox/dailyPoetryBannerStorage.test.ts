import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock('../../../../services/clientStorage', () => clientStorageMocks);

import {
  dismissDailyPoetryBannerForDate,
  readDailyPoetryBannerSnapshot,
} from './dailyPoetryBannerStorage';

describe('dailyPoetryBannerStorage', () => {
  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
  });

  it('reads the Composer-specific dismissal date and hides only that date', () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue('2026-08-10');

    const snapshot = readDailyPoetryBannerSnapshot(new Date(2026, 7, 10, 20));

    expect(clientStorageMocks.getClientStoreSync).toHaveBeenCalledWith(
      'app',
      'composer.dailyPoetryBannerDismissedDate',
    );
    expect(snapshot.isVisible).toBe(false);
  });

  it('fails open for malformed persisted values', () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue({ dismissed: true });

    expect(readDailyPoetryBannerSnapshot(new Date(2026, 7, 10, 20)).isVisible).toBe(true);
  });

  it('persists the local date at dismissal time', () => {
    dismissDailyPoetryBannerForDate(new Date(2026, 7, 11, 0, 5));

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      'app',
      'composer.dailyPoetryBannerDismissedDate',
      '2026-08-11',
    );
  });
});
