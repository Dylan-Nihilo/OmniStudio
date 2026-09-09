import { act, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import { usePlaygroundStore } from './usePlaygroundStore';
import ParameterBar from './ParameterBar';
import MediaInput from './MediaInput';

it('writes the visible model defaults into requests after selection and reset', async () => {
  usePlaygroundStore.setState({ ...usePlaygroundStore.getInitialState(), mode: 'i2v', modelId: 'happyhorse-1.1-i2v' }, true);
  const view = renderWithIntl(<ParameterBar />);
  try {
    await waitFor(() => expect(usePlaygroundStore.getState().parameters.resolution).toBe('1080p'));
    expect(usePlaygroundStore.getState().parameters.duration).toBeGreaterThan(0);
    act(() => usePlaygroundStore.getState().resetInput());
    await waitFor(() => expect(usePlaygroundStore.getState().parameters.resolution).toBe('1080p'));
    act(() => usePlaygroundStore.getState().setParameters({ resolution: 'INVALID', duration: 999 }));
    await waitFor(() => expect(usePlaygroundStore.getState().parameters.resolution).toBe('1080p'));
    expect(usePlaygroundStore.getState().parameters.duration).toBeLessThan(999);
  } finally { view.unmount(); }
});

it('uses the selected reference model limit in both count and upload guidance', () => {
  usePlaygroundStore.setState({ ...usePlaygroundStore.getInitialState(), mode: 'r2v', modelId: 'wan2.7-r2v', inputMedia: ['one.png'] }, true);
  const view = renderWithIntl(<MediaInput />);
  try {
    expect(screen.getByText('1 / 5 张')).toBeInTheDocument();
    expect(screen.queryByText(/最多 9 张/)).not.toBeInTheDocument();
  } finally { view.unmount(); }
});
