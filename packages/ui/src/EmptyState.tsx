"use client";

import { EmptyState as HeroEmptyState } from '@heroui-pro/react/empty-state';
import type { ComponentProps, ReactNode } from 'react';

export type EmptyStateProps = Omit<ComponentProps<typeof HeroEmptyState>, 'children' | 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  media?: ReactNode;
};

export function EmptyState({ title, description, action, media, className = '', ...props }: EmptyStateProps) {
  return (
    <HeroEmptyState {...props} className={`omni-empty-state ${className}`}>
      <HeroEmptyState.Header>
        {media && <HeroEmptyState.Media>{media}</HeroEmptyState.Media>}
        <HeroEmptyState.Title>{title}</HeroEmptyState.Title>
        {description && <HeroEmptyState.Description>{description}</HeroEmptyState.Description>}
      </HeroEmptyState.Header>
      {action && <HeroEmptyState.Content>{action}</HeroEmptyState.Content>}
    </HeroEmptyState>
  );
}
