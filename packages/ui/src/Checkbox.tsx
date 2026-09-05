"use client";

import { Checkbox as HeroCheckbox, Description, FieldError } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

export type CheckboxProps = Omit<ComponentProps<typeof HeroCheckbox>, 'children' | 'className'> & {
  children: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  className?: string;
};

export function Checkbox({ children, description, errorMessage, className = '', ...props }: CheckboxProps) {
  return (
    <HeroCheckbox {...props} className={`omni-checkbox ${className}`}>
      <HeroCheckbox.Content>
        <HeroCheckbox.Control><HeroCheckbox.Indicator /></HeroCheckbox.Control>
        {children}
      </HeroCheckbox.Content>
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroCheckbox>
  );
}
