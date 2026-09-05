"use client";

import { Chip } from '@heroui/react';
import type { ComponentProps } from 'react';

export type StatusBadgeProps = Omit<ComponentProps<typeof Chip>, 'color' | 'variant'> & {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
};

export function StatusBadge({ tone = 'neutral', className = '', children, ...props }: StatusBadgeProps) {
  return <Chip {...props} variant="tertiary" className={`omni-status ${className}`} data-tone={tone}><span className="omni-status-dot" aria-hidden="true" /><Chip.Label>{children}</Chip.Label></Chip>;
}
