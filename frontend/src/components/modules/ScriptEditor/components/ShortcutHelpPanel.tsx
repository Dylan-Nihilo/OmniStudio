'use client';

import { Dialog } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';

interface ShortcutHelpPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string;
  descKey: string;
}

interface ShortcutGroup {
  titleKey: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.groupEdit',
    items: [
      { keys: 'Tab', descKey: 'shortcuts.cycleNodeType' },
      { keys: 'Shift+Tab', descKey: 'shortcuts.reverseNodeType' },
      { keys: 'Enter', descKey: 'shortcuts.createNextNode' },
      { keys: '⌘+Enter', descKey: 'shortcuts.newScene' },
      { keys: '⌘+D', descKey: 'shortcuts.dualDialogue' },
      { keys: '@', descKey: 'shortcuts.mentionCharacter' },
    ],
  },
  {
    titleKey: 'shortcuts.groupNavigation',
    items: [
      { keys: '⌘+Shift+F', descKey: 'shortcuts.search' },
      { keys: '⌘+Shift+E', descKey: 'shortcuts.toggleFolding' },
      { keys: 'Escape', descKey: 'shortcuts.exitFocus' },
    ],
  },
  {
    titleKey: 'shortcuts.groupFormat',
    items: [
      { keys: '⌘+Z', descKey: 'shortcuts.undo' },
      { keys: '⌘+Shift+Z', descKey: 'shortcuts.redo' },
    ],
  },
  {
    titleKey: 'shortcuts.groupView',
    items: [
      { keys: '⌘+S', descKey: 'shortcuts.save' },
      { keys: '⌘+/', descKey: 'shortcuts.showHelp' },
    ],
  },
];

/**
 * 快捷键帮助面板组件
 * - 模态面板，显示所有可用快捷键
 * - 分组显示：编辑 | 导航 | 格式 | 视图
 * - 暗色主题，支持 Escape 关闭
 */
export function ShortcutHelpPanel({ open, onClose }: ShortcutHelpPanelProps) {
  const t = useTranslations('scriptEditor');
  return <Dialog isOpen={open} onOpenChange={value => { if (!value) onClose(); }} title={t('shortcuts.title')} closeLabel={t('shortcuts.close')}>
        {/* Shortcut Groups */}
        <div className="px-6 py-4 space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                {t(group.titleKey)}
              </h3>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-hover-bg transition-colors"
                  >
                    <span className="text-sm text-text-secondary">{t(item.descKey)}</span>
                    <kbd className="inline-flex items-center gap-0.5 rounded border border-glass-border bg-surface-inset px-2 py-0.5 text-xs font-mono text-text-muted">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

    </Dialog>;
}
