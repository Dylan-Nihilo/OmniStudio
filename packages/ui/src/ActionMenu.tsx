"use client";

import { Dropdown, Label } from '@heroui/react';
import type { ReactNode } from 'react';
import { Button } from './Button';

export type ActionMenuProps = {
  label: string;
  icon?: ReactNode;
  items: readonly { id: string; label: string; icon?: ReactNode; isDisabled?: boolean; onAction: () => void }[];
  className?: string;
};

export function ActionMenu({ label, icon, items, className }: ActionMenuProps) {
  return <Dropdown>
    <Button variant="quiet" isIconOnly={Boolean(icon)} aria-label={label} className={className}>{icon || label}</Button>
    <Dropdown.Popover placement="bottom end">
      <Dropdown.Menu aria-label={label}>
        {items.map(item => <Dropdown.Item key={item.id} id={item.id} textValue={item.label} isDisabled={item.isDisabled} onAction={item.onAction}>
          {item.icon}<Label>{item.label}</Label>
        </Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
