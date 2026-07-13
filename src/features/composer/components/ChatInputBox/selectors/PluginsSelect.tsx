import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Puzzle from 'lucide-react/dist/esm/icons/puzzle';
import { useInstalledPlugins } from '../../../../plugins/installedPluginsStore';
import { requestOpenPluginsPage } from '../../../../plugins/pluginsNavigationBus';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface PluginsSelectProps {
  /** 点选带 skill 能力的插件时回调（复用 $ 技能选择链路） */
  onSelectSkill?: (skillName: string) => void;
}

/**
 * PluginsSelect - Composer toolbar plugins entry
 * Icon-only trigger that lists installed plugins and links to the plugins page.
 * Plugins carrying a skill capability are selectable and feed onSelectSkill.
 */
export const PluginsSelect = memo(({ onSelectSkill }: PluginsSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const plugins = useInstalledPlugins();
  const buttonTitle = t('pluginsPage.composerButtonTitle', { defaultValue: '插件' });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="selector-button selector-plugins-trigger"
          title={buttonTitle}
          aria-label={buttonTitle}
        >
          <Puzzle size={14} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-64">
        {plugins.length > 0 ? (
          <>
            <DropdownMenuLabel>
              {t('pluginsPage.composerInstalledCount', {
                count: plugins.length,
                defaultValue: `${plugins.length} 个已安装插件`,
              })}
            </DropdownMenuLabel>
            {plugins.map((plugin) => {
              const skillName = plugin.manifest.capabilities.skill
                ? plugin.manifest.id
                : null;
              const rowContent = (
                <>
                  <Puzzle size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{plugin.manifest.name}</span>
                  {plugin.manifest.version ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('pluginsPage.versionLabel', {
                        version: plugin.manifest.version,
                        defaultValue: `版本 ${plugin.manifest.version}`,
                      })}
                    </span>
                  ) : null}
                </>
              );
              // 带 skill 能力的插件可点选（选中后随本条消息以 /skill 形式生效）；
              // 纯 viewer 等无 skill 的插件保持展示行。
              return skillName && onSelectSkill ? (
                <DropdownMenuItem
                  key={plugin.manifest.id}
                  className="flex items-center gap-2"
                  data-plugin-id={plugin.manifest.id}
                  onSelect={() => onSelectSkill(skillName)}
                >
                  {rowContent}
                </DropdownMenuItem>
              ) : (
                <div
                  key={plugin.manifest.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm"
                  data-plugin-id={plugin.manifest.id}
                >
                  {rowContent}
                </div>
              );
            })}
          </>
        ) : (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t('pluginsPage.composerEmpty', { defaultValue: '还没有安装插件' })}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => requestOpenPluginsPage()}>
          {t('pluginsPage.composerManage', { defaultValue: '管理插件…' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default PluginsSelect;
