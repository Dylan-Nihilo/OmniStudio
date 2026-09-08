'use client';

import { useTranslations } from 'next-intl';
import { Tabs } from '@omnistudio/ui';
import { Film, ListTree, Search } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import SceneNavigator from './SceneNavigator';
import OutlineView from './OutlineView';
import SearchPanel from './SearchPanel';

export type SidebarTab = 'scenes' | 'outline' | 'search';
export interface LeftSidebarProps { editor: Editor | null; tab: SidebarTab; onTabChange: (tab: SidebarTab) => void; onNavigate?: () => void; }

export default function LeftSidebar({ editor, tab, onTabChange, onNavigate }: LeftSidebarProps) {
  const t = useTranslations('scriptEditor');
  const tabs = [
    { id: 'scenes', label: t('sidebar.scenes'), icon: Film, content: <SceneNavigator editor={editor} onNavigate={onNavigate} /> },
    { id: 'outline', label: t('sidebar.outline'), icon: ListTree, content: <OutlineView editor={editor} onNavigate={onNavigate} /> },
    { id: 'search', label: t('sidebar.search'), icon: Search, content: <SearchPanel editor={editor} onNavigate={onNavigate} /> },
  ];
  return <Tabs aria-label={t('shell.outline')} selectedKey={tab} onSelectionChange={key => onTabChange(String(key) as SidebarTab)} items={tabs} className="flex h-full min-h-0 flex-col [&_[role=tablist]]:w-full [&_[role=tab]]:flex-1 [&_[role=tabpanel]]:min-h-0 [&_[role=tabpanel]]:flex-1 [&_[role=tabpanel]]:overflow-y-auto" />;
}
