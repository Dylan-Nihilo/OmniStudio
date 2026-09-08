"use client";

import { Stepper } from '@heroui-pro/react/stepper';
import type { ComponentProps } from 'react';

export type WorkflowStepsProps = Omit<ComponentProps<typeof Stepper>, 'children'> & {
  steps: readonly { id: string; title: string; description?: string }[];
};

export function WorkflowSteps({ steps, className = '', ...props }: WorkflowStepsProps) {
  return (
    <Stepper {...props} className={`omni-workflow-steps ${className}`}>
      {steps.map(step => (
        <Stepper.Step key={step.id}>
          <Stepper.Indicator />
          <Stepper.Content><Stepper.Title>{step.title}</Stepper.Title>{step.description && <Stepper.Description>{step.description}</Stepper.Description>}</Stepper.Content>
          <Stepper.Separator />
        </Stepper.Step>
      ))}
    </Stepper>
  );
}
