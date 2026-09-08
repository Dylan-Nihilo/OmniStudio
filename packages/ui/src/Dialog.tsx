"use client";

import { Modal } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

export type DialogProps = Pick<ComponentProps<typeof Modal>, 'isOpen' | 'defaultOpen' | 'onOpenChange'> & {
  title: ReactNode;
  children: ReactNode;
  trigger?: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  className?: string;
  isDismissable?: boolean;
};

export function Dialog({ title, children, trigger, footer, closeLabel, className = '', isDismissable = true, ...props }: DialogProps) {
  const overlay = (
    <Modal.Backdrop {...(trigger ? {} : props)} isDismissable={isDismissable} isKeyboardDismissDisabled={!isDismissable}>
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog className={`omni-dialog ${className}`}>
          <Modal.CloseTrigger aria-label={closeLabel} isDisabled={!isDismissable} />
          <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          {footer && <Modal.Footer>{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
  return trigger ? <Modal {...props}>{trigger}{overlay}</Modal> : overlay;
}
