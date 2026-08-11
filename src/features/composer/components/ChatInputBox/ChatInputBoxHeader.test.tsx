// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInputBoxHeader } from './ChatInputBoxHeader';

const t = ((key: string) => (key === 'common.close' ? '关闭' : key)) as TFunction;

const baseProps = {
  sdkInstalled: true,
  sdkStatusLoading: false,
  currentProvider: 'codex',
  t,
  attachments: [],
  onRemoveAttachment: vi.fn(),
};

describe('ChatInputBoxHeader daily poetry banner', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders attributed poetry and exposes a localized close control', () => {
    const onDismissDailyPoetry = vi.fn();
    render(
      <ChatInputBoxHeader
        {...baseProps}
        dailyPoetryText="“会当凌绝顶，一览众山小。” —— 杜甫《望岳》"
        onDismissDailyPoetry={onDismissDailyPoetry}
      />,
    );

    expect(screen.getByText('“会当凌绝顶，一览众山小。” —— 杜甫《望岳》')).toBeTruthy();
    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton.getAttribute('title')).toBe('关闭');

    fireEvent.click(closeButton);
    expect(onDismissDailyPoetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the SDK warning visible beside the daily poetry banner', () => {
    render(
      <ChatInputBoxHeader
        {...baseProps}
        sdkInstalled={false}
        dailyPoetryText="“野火烧不尽，春风吹又生。” —— 白居易《赋得古原草送别》"
      />,
    );

    expect(screen.getByText('“野火烧不尽，春风吹又生。” —— 白居易《赋得古原草送别》')).toBeTruthy();
    expect(screen.getByText('chat.sdkNotInstalled')).toBeTruthy();
  });
});
