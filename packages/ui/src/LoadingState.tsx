"use client";

import { Skeleton as HeroSkeleton, Spinner } from '@heroui/react';
import type { ComponentProps } from 'react';

export function LoadingState({ label, inline = false, className = '' }: { label: string; inline?: boolean; className?: string }) {
  return <div role="status" aria-live="polite" className={`omni-loading ${inline ? 'omni-loading--inline' : ''} ${className}`}>
    <Spinner aria-hidden="true" color="current" size={inline ? 'sm' : 'md'} />
    <span>{label}</span>
  </div>;
}

export function Skeleton({ className = '', ...props }: ComponentProps<typeof HeroSkeleton>) {
  return <HeroSkeleton {...props} aria-hidden="true" className={`omni-skeleton ${className}`} />;
}
