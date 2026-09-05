"use client";

import { Tabs as HeroTabs } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

export type TabsProps = Omit<ComponentProps<typeof HeroTabs>, 'children' | 'className'> & {
  'aria-label': string;
  items: readonly { id: string; label: string; content: ReactNode; isDisabled?: boolean }[];
  className?: string;
};

export function Tabs({ items, 'aria-label': label, className = '', ...props }: TabsProps) {
  return (
    <HeroTabs variant="secondary" {...props} className={`omni-tabs ${className}`}>
      <HeroTabs.ListContainer>
        <HeroTabs.List aria-label={label}>
          {items.map(item => <HeroTabs.Tab key={item.id} id={item.id} isDisabled={item.isDisabled}>{item.label}<HeroTabs.Indicator /></HeroTabs.Tab>)}
        </HeroTabs.List>
      </HeroTabs.ListContainer>
      {items.map(item => <HeroTabs.Panel key={item.id} id={item.id}>{item.content}</HeroTabs.Panel>)}
    </HeroTabs>
  );
}
