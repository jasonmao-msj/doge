import { describe, expect, it } from 'vitest';
import {
  DAILY_POETRY_EXCERPTS,
  createDailyPoetryBannerSnapshot,
  formatDailyPoetryExcerpt,
  getDailyPoetry,
  getLocalDateKey,
  isDailyPoetryBannerDismissed,
} from './dailyPoetry';

function localDateWithOffset(offsetDays: number, hour = 12): Date {
  return new Date(2026, 0, 7 + offsetDays, hour, 0, 0, 0);
}

describe('dailyPoetry', () => {
  it('ships exactly 30 unique attributed excerpts for a 30-day rotation', () => {
    expect(DAILY_POETRY_EXCERPTS).toHaveLength(30);
    expect(new Set(DAILY_POETRY_EXCERPTS.map((entry) => entry.text)).size).toBe(
      DAILY_POETRY_EXCERPTS.length,
    );
    for (const entry of DAILY_POETRY_EXCERPTS) {
      expect(entry.text.trim()).not.toBe('');
      expect(entry.author.trim()).not.toBe('');
      expect(entry.title.trim()).not.toBe('');
    }
  });

  it('formats the excerpt with author and work title', () => {
    expect(
      formatDailyPoetryExcerpt({
        text: '会当凌绝顶，一览众山小。',
        author: '杜甫',
        title: '望岳',
      }),
    ).toBe('“会当凌绝顶，一览众山小。” —— 杜甫《望岳》');
  });

  it('returns the same excerpt throughout one local calendar day', () => {
    const early = localDateWithOffset(0, 0);
    const late = localDateWithOffset(0, 23);

    expect(getDailyPoetry(early)).toEqual(getDailyPoetry(late));
    expect(getLocalDateKey(early)).toBe('2026-01-07');
  });

  it('does not repeat in any consecutive interval matching the pool length', () => {
    for (const startOffset of [0, 5, DAILY_POETRY_EXCERPTS.length - 2]) {
      const excerpts = Array.from({ length: DAILY_POETRY_EXCERPTS.length }, (_, index) =>
        getDailyPoetry(localDateWithOffset(startOffset + index)).text,
      );
      expect(new Set(excerpts).size).toBe(DAILY_POETRY_EXCERPTS.length);
    }
  });

  it('does not repeat on adjacent days across a rotation boundary', () => {
    const finalDay = new Date(1970, 0, DAILY_POETRY_EXCERPTS.length, 12);
    const nextDay = new Date(1970, 0, DAILY_POETRY_EXCERPTS.length + 1, 12);

    expect(getDailyPoetry(finalDay).text).not.toBe(getDailyPoetry(nextDay).text);
  });

  it('treats dismissal as valid only for the current local date', () => {
    const today = localDateWithOffset(0);
    const tomorrow = localDateWithOffset(1);

    expect(isDailyPoetryBannerDismissed('2026-01-07', today)).toBe(true);
    expect(isDailyPoetryBannerDismissed('2026-01-07', tomorrow)).toBe(false);
    expect(isDailyPoetryBannerDismissed('not-a-date', today)).toBe(false);
    expect(isDailyPoetryBannerDismissed({ date: '2026-01-07' }, today)).toBe(false);
  });

  it('creates a visible snapshot when dismissal is missing or from another day', () => {
    const today = localDateWithOffset(0);
    const visible = createDailyPoetryBannerSnapshot(today, undefined);
    const dismissed = createDailyPoetryBannerSnapshot(today, visible.dateKey);

    expect(visible.isVisible).toBe(true);
    expect(visible.displayText).toContain('《');
    expect(dismissed.isVisible).toBe(false);
  });

  it('rejects invalid Date values', () => {
    expect(() => getDailyPoetry(new Date(Number.NaN))).toThrow(RangeError);
  });
});
