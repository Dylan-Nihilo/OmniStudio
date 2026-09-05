"use client";

import { Sidebar } from '@heroui-pro/react/sidebar';
import type { ComponentProps, ReactNode } from 'react';

export type NavigationMenuProps = {
  'aria-label': string;
  items: readonly { id: string; label: string; href: string; icon?: ReactNode; isDisabled?: boolean }[];
  currentId: string;
  onNavigate?: ComponentProps<typeof Sidebar.Provider>['navigate'];
  className?: string;
};

export function NavigationMenu({ items, currentId, onNavigate, className = '', 'aria-label': label }: NavigationMenuProps) {
  return (
    <Sidebar.Provider collapsible="none" toggleShortcut={false} navigate={onNavigate} className={`omni-navigation ${className}`}>
      <Sidebar.Group>
        <Sidebar.Menu aria-label={label}>
          {items.map(item => (
            <Sidebar.MenuItem key={item.id} id={item.id} href={item.href} textValue={item.label} isCurrent={item.id === currentId} isDisabled={item.isDisabled} render={domProps => <div {...domProps} aria-current={item.id === currentId ? 'page' : undefined} />}>
              {item.icon && <Sidebar.MenuIcon>{item.icon}</Sidebar.MenuIcon>}
              <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          ))}
        </Sidebar.Menu>
      </Sidebar.Group>
    </Sidebar.Provider>
  );
}
