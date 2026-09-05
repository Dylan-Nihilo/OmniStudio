"use client";

import { Modal } from '@heroui/react';
import type { ComponentProps, ReactNode } from 'react';

export type DialogProps = Omit<ComponentProps<typeof Modal>, 'children'> & {
  title: ReactNode;
  children: ReactNode;
  trigger?: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
};

export function Dialog({ title, children, trigger, footer, closeLabel, ...props }: DialogProps) {
  return (
    <Modal {...props}>
      {trigger}
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="omni-dialog">
            <Modal.CloseTrigger aria-label={closeLabel} />
            <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
            <Modal.Body>{children}</Modal.Body>
            {footer && <Modal.Footer>{footer}</Modal.Footer>}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
