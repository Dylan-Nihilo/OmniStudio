import { expect, it } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import StepPageHeader from './StepPageHeader';

it('keeps the step header compact while preserving the title and primary action', () => {
  const view = renderWithIntl(<StepPageHeader stepNumber={2} englishName="Art Direction" title="画风" subtitle="设置本集视觉方向" trailing={<button>保存</button>} />);
  const header = view.container.querySelector('header');
  expect(header).toHaveClass('py-3.5');
  expect(header).toHaveTextContent('画风');
  expect(header).toHaveTextContent('保存');
});
