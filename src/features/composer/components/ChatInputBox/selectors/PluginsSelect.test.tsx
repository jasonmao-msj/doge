// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../../../../plugins/types';
import { PluginsSelect } from './PluginsSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const useInstalledPluginsMock = vi.fn<() => InstalledPlugin[]>(() => []);
vi.mock('../../../../plugins/installedPluginsStore', () => ({
  useInstalledPlugins: () => useInstalledPluginsMock(),
}));

const requestOpenPluginsPageMock = vi.fn();
vi.mock('../../../../plugins/pluginsNavigationBus', () => ({
  requestOpenPluginsPage: () => requestOpenPluginsPageMock(),
}));

function makePlugin(
  id: string,
  name: string,
  version: string,
  options?: { withSkill?: boolean },
): InstalledPlugin {
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name,
      version,
      description: '',
      keywords: [],
      capabilities: options?.withSkill ? { skill: { entry: 'SKILL.md' } } : {},
    },
    installPath: `/plugins/${id}`,
    skillLinked: false,
  };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '插件' }));
  await waitFor(() => {
    expect(screen.getByText('管理插件…')).toBeTruthy();
  });
}

describe('PluginsSelect', () => {
  beforeEach(() => {
    useInstalledPluginsMock.mockReturnValue([]);
    requestOpenPluginsPageMock.mockClear();
  });

  it('shows the empty state when no plugins are installed', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PluginsSelect />);

    await openMenu(user);

    expect(screen.getByText('还没有安装插件')).toBeTruthy();
    expect(screen.queryByText(/个已安装插件/)).toBeNull();
  });

  it('lists installed plugins with count label and version', async () => {
    useInstalledPluginsMock.mockReturnValue([
      makePlugin('alpha', 'Alpha 插件', '1.0.0'),
      makePlugin('beta', 'Beta 插件', '2.1.0'),
    ]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PluginsSelect />);

    await openMenu(user);

    expect(screen.getByText('2 个已安装插件')).toBeTruthy();
    expect(screen.getByText('Alpha 插件')).toBeTruthy();
    expect(screen.getByText('Beta 插件')).toBeTruthy();
    expect(screen.getByText('版本 1.0.0')).toBeTruthy();
    expect(screen.getByText('版本 2.1.0')).toBeTruthy();
    expect(screen.queryByText('还没有安装插件')).toBeNull();
  });

  it('selects the skill when clicking a skill-capable plugin row', async () => {
    useInstalledPluginsMock.mockReturnValue([
      makePlugin('gzh-design', '公众号排版', '1.0.0', { withSkill: true }),
    ]);
    const onSelectSkill = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PluginsSelect onSelectSkill={onSelectSkill} />);

    await openMenu(user);
    await user.click(screen.getByText('公众号排版'));

    expect(onSelectSkill).toHaveBeenCalledWith('gzh-design');
  });

  it('keeps plugins without a skill capability non-selectable', async () => {
    useInstalledPluginsMock.mockReturnValue([
      makePlugin('viewer-only', '纯预览插件', '1.0.0'),
    ]);
    const onSelectSkill = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PluginsSelect onSelectSkill={onSelectSkill} />);

    await openMenu(user);
    await user.click(screen.getByText('纯预览插件'));

    expect(onSelectSkill).not.toHaveBeenCalled();
  });

  it('requests opening the plugins page from the manage entry', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PluginsSelect />);

    await openMenu(user);
    await user.click(screen.getByText('管理插件…'));

    expect(requestOpenPluginsPageMock).toHaveBeenCalledTimes(1);
  });
});
