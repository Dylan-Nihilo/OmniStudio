"use client";

import { Description, FieldError, Input, Label, TextArea, TextField as HeroTextField } from '@heroui/react';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { IconButton } from './Button';

export type TextFieldProps = Omit<ComponentProps<typeof HeroTextField>, 'children' | 'className'> & {
  label: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: string;
  className?: string;
  inputRef?: ComponentProps<typeof Input>['ref'];
};

export function TextField({ label, description, errorMessage, placeholder, className = '', inputRef, ...props }: TextFieldProps) {
  return (
    <HeroTextField {...props} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <Input ref={inputRef} placeholder={placeholder} />
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroTextField>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'> & {
  showPasswordLabel: string;
  hidePasswordLabel: string;
};

export function PasswordField({ label, description, errorMessage, placeholder, className = '', inputRef, showPasswordLabel, hidePasswordLabel, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <HeroTextField {...props} type={visible ? 'text' : 'password'} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <div className="omni-password">
        <Input ref={inputRef} placeholder={placeholder} />
        <IconButton type="button" isDisabled={props.isDisabled} aria-label={visible ? hidePasswordLabel : showPasswordLabel} aria-pressed={visible} onPress={() => setVisible(!visible)}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      </div>
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroTextField>
  );
}

export type TextAreaFieldProps = Omit<TextFieldProps, 'type' | 'inputRef'> & {
  rows?: number;
  inputRef?: ComponentProps<typeof TextArea>['ref'];
};

export function TextAreaField({ label, description, errorMessage, placeholder, className = '', rows = 4, inputRef, ...props }: TextAreaFieldProps) {
  return (
    <HeroTextField {...props} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <TextArea ref={inputRef} placeholder={placeholder} rows={rows} />
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroTextField>
  );
}
