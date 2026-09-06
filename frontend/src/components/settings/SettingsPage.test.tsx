// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

const mocks = vi.hoisted(() => ({
  getEnvConfig: vi.fn(), saveEnvConfig: vi.fn(), fetchPromptDefaults: vi.fn(), healthCheck: vi.fn(), checkSystem: vi.fn(), triggerMulerunLogin: vi.fn(),
}));
const t = vi.hoisted(() => (key: string) => key);
vi.mock('next-intl', () => ({useTranslations: () => t}));
vi.mock('@/lib/api', () => ({api: mocks, API_URL: 'http://localhost:3021'}));
vi.mock('@/components/layout/OmniStudioBranding', () => ({default: () => null}));
vi.mock('./UpdateChecker', () => ({default: () => null}));
vi.mock('@/store/toastStore', () => ({toast: {success: vi.fn(), error: vi.fn()}, useToastStore: {getState: () => ({clear: vi.fn()})}}));

const config = {DASHSCOPE_API_KEY:'sk-••••••••demo', LLM_PROVIDER:'dashscope', OSS_ENABLE:false, OSS_BUCKET_NAME:'original-bucket'};
const choose = (name: string) => fireEvent.click(screen.getByRole('tab', {name}));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.getEnvConfig.mockResolvedValue(config);
  mocks.saveEnvConfig.mockResolvedValue({status:'success'});
  mocks.fetchPromptDefaults.mockResolvedValue({});
  mocks.healthCheck.mockResolvedValue({log_dir:'/demo/logs',log_file:'/demo/logs/app.log'});
  mocks.checkSystem.mockResolvedValue({status:'ok',dependencies:{ffmpeg:{available:true,message:'available'}}});
});
afterEach(() => {vi.useRealTimers();vi.restoreAllMocks();});

describe('settings persistence', () => {
  it('saves only edited storage fields and retains the draft after a failed save', async () => {
    mocks.saveEnvConfig.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({status:'success'});
    render(<SettingsPage />);
    await waitFor(() => expect(mocks.getEnvConfig).toHaveBeenCalledOnce());
    choose('tabStorage');
    const bucket = await screen.findByDisplayValue('original-bucket');
    fireEvent.change(bucket, {target:{value:'new-bucket'}});
    fireEvent.click(screen.getByRole('button',{name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledWith({OSS_BUCKET_NAME:'new-bucket'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('saveConfigFailed');
    expect(bucket).toHaveValue('new-bucket');
    fireEvent.click(screen.getByRole('button',{name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledTimes(2));
  });

  it('blocks storage writes after loading fails and lets the user retry loading', async () => {
    mocks.getEnvConfig.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(config);
    render(<SettingsPage />);
    choose('tabStorage');
    expect(await screen.findByRole('alert')).toHaveTextContent('loadConfigFailed');
    expect(screen.queryByDisplayValue('original-bucket')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'saveConfig'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'retryLoad'}));
    expect(await screen.findByDisplayValue('original-bucket')).toBeInTheDocument();
    expect(mocks.saveEnvConfig).not.toHaveBeenCalled();
  });
});
