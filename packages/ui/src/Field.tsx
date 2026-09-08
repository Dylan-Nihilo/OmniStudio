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

export function TextField({ label, description, errorMessage, placeholder, className = '', inputRef, autoFocus, ...props }: TextFieldProps) {
  return (
    <HeroTextField {...props} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <Input autoFocus={autoFocus} ref={inputRef} placeholder={placeholder} />
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroTextField>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'> & {
  showPasswordLabel: string;
  hidePasswordLabel: string;
  isRevealDisabled?: boolean;
};

export function PasswordField({ label, description, errorMessage, placeholder, className = '', inputRef, autoFocus, showPasswordLabel, hidePasswordLabel, isRevealDisabled = false, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const shown = visible && !isRevealDisabled;
  return (
    <HeroTextField {...props} type={shown ? 'text' : 'password'} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <div className="omni-password">
        <Input autoFocus={autoFocus} ref={inputRef} placeholder={placeholder} />
        <IconButton type="button" isDisabled={props.isDisabled || isRevealDisabled} aria-label={shown ? hidePasswordLabel : showPasswordLabel} aria-pressed={shown} onPress={() => setVisible(!shown)}>
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
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

export function TextAreaField({ label, description, errorMessage, placeholder, className = '', rows = 4, inputRef, autoFocus, ...props }: TextAreaFieldProps) {
  return (
    <HeroTextField {...props} className={`omni-field ${className}`}>
      <Label>{label}</Label>
      <TextArea autoFocus={autoFocus} ref={inputRef} placeholder={placeholder} rows={rows} />
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </HeroTextField>
  );
}
