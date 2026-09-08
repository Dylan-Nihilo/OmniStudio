"use client";

import { Description, FieldError, Label, ListBox, Select } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

export type SelectFieldProps = Omit<ComponentProps<typeof Select>, 'children' | 'className'> & {
  label: ReactNode;
  options: readonly { id: string; label: string; description?: string }[];
  description?: ReactNode;
  errorMessage?: ReactNode;
  className?: string;
};

export function SelectField({ label, options, description, errorMessage, className = '', ...props }: SelectFieldProps) {
  return (
    <Select {...props} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
      <Select.Popover className="omni-select-popover">
        <ListBox>
          {options.map(option => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              <Label>{option.label}</Label>
              {option.description && <Description>{option.description}</Description>}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
