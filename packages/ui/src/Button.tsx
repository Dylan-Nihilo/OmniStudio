"use client";

import { Button as HeroButton, Spinner } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

const variants = { primary: 'primary', secondary: 'outline', quiet: 'ghost', danger: 'danger' } as const;

export type ButtonProps = Omit<ComponentProps<typeof HeroButton>, 'variant' | 'className'> & {
  variant?: keyof typeof variants;
  className?: string;
};

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <HeroButton {...props} aria-busy={props.isPending || undefined} variant={variants[variant]} className={`omni-button ${className}`}>
      {(state) => <>{state.isPending && <Spinner aria-hidden="true" size="sm" color="current" />}{typeof children === 'function' ? children(state) : children}</>}
    </HeroButton>
  );
}

export type IconButtonProps = Omit<ButtonProps, 'children' | 'isIconOnly' | 'aria-label'> & {
  'aria-label': string;
  children: ReactNode;
};

export function IconButton({ variant = 'quiet', ...props }: IconButtonProps) {
  return <Button {...props} variant={variant} isIconOnly />;
}
