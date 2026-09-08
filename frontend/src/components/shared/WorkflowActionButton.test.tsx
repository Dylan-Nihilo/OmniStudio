import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import WorkflowActionButton from './WorkflowActionButton';

it('keeps the current action focused while pending and prevents repeated submission', () => {
  const onClick = vi.fn();
  const view = render(<WorkflowActionButton onClick={onClick}>Apply</WorkflowActionButton>);
  const button = screen.getByRole('button', { name: 'Apply' });
  button.focus();
  fireEvent.click(button);
  view.rerender(<WorkflowActionButton loading onClick={onClick}>Saving</WorkflowActionButton>);
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  view.rerender(<WorkflowActionButton onClick={onClick}>Apply</WorkflowActionButton>);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(2);
});
