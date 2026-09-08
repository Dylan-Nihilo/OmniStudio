// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('saves the new image and MiniMax provider fields through the shared configuration surface', async () => {
    mocks.getEnvConfig.mockResolvedValue({...config, IMAGE_PROVIDER:'openai', OPENAI_IMAGE_API_KEY:'sk-••••image'});
    const onSaved = vi.fn();
    render(<SettingsPage initialCategory="apikeys" onProviderConfigSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText('OpenAI Image API Key'), {target:{value:'test-image-replacement'}});
    fireEvent.change(screen.getByLabelText('imageModel'), {target:{value:'test-image-model'}});
    fireEvent.change(screen.getByLabelText('MOMA API Key'), {target:{value:'test-moma-replacement'}});
    fireEvent.click(screen.getByRole('button',{name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledWith({OPENAI_IMAGE_API_KEY:'test-image-replacement', OPENAI_IMAGE_MODEL:'test-image-model', MOMA_API_KEY:'test-moma-replacement'}));
    expect(onSaved).toHaveBeenCalledOnce();
  });
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


describe('settings controls and recovery', () => {
  it('never copies a masked key and writes only the replacement provider key', async () => {
    render(<SettingsPage />);
    choose('tabApikeys');
    const key = await screen.findByLabelText('DashScope API Key');
    const group = within(screen.getByRole('group', {name:'dashscopeKeyLabel'}));
    expect(group.getByRole('button', {name:'copyKey'})).toBeDisabled();
    expect(group.getByRole('button', {name:'showKey'})).toBeDisabled();
    key.focus();
    fireEvent.change(key, {target:{value:'s'}});
    expect(group.getByLabelText('DashScope API Key')).toHaveFocus();
    fireEvent.change(group.getByLabelText('DashScope API Key'), {target:{value:'sk-test-replacement'}});
    expect(group.getByRole('button', {name:'copyKey'})).toBeEnabled();
    fireEvent.click(group.getByRole('button', {name:'showKey'}));
    expect(group.getByLabelText('DashScope API Key')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', {name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledWith({DASHSCOPE_API_KEY:'sk-test-replacement'}));
  });

  it('retains prompt edits after browser storage fails and saves only overrides on retry', async () => {
    mocks.fetchPromptDefaults.mockResolvedValue({entity_extraction:'Built-in entity prompt', style_analysis:'Built-in style prompt'});
    render(<SettingsPage />);
    choose('tabPrompts');
    await screen.findByDisplayValue('Built-in entity prompt');
    fireEvent.change(screen.getByRole('textbox', {name:'promptStyleLabel'}), {target:{value:'Custom style prompt'}});
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {throw new Error('Quota exceeded');});
    fireEvent.click(screen.getByRole('button', {name:'saveDefaults'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('saveLocalFailed');
    expect(screen.getByRole('textbox', {name:'promptStyleLabel'})).toHaveValue('Custom style prompt');
    storage.mockRestore();
    fireEvent.click(screen.getByRole('button', {name:'saveDefaults'}));
    expect(JSON.parse(localStorage.getItem('omni_studio_default_prompt_config')!)).toEqual({entity_extraction:'', style_analysis:'Custom style prompt', storyboard_extraction:'', storyboard_polish:'', video_polish:'', r2v_polish:''});
    choose('tabModels');
    fireEvent.click(screen.getByRole('button', {name:'saveDefaults'}));
    const models = JSON.parse(localStorage.getItem('omni_studio_default_model_settings')!);
    expect(models.t2i_model).toBe(models.i2i_model);
    expect(models.t2i_model).toBe(models.image_model);
    expect(mocks.saveEnvConfig).not.toHaveBeenCalled();
  });

  it('does not overwrite a prompt explicitly cleared while defaults are loading', async () => {
    let finish!: (value: Record<string,string>) => void;
    mocks.fetchPromptDefaults.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    render(<SettingsPage />);
    choose('tabPrompts');
    const field = screen.getByRole('textbox', {name:'promptEntityLabel'});
    fireEvent.change(field, {target:{value:'Draft'}});
    fireEvent.change(field, {target:{value:''}});
    await act(async () => finish({entity_extraction:'Late default'}));
    expect(field).toHaveValue('');
  });

  it('disables repeated saves until the outstanding request resolves', async () => {
    let finish!: () => void;
    mocks.saveEnvConfig.mockReturnValue(new Promise<void>(resolve => {finish = resolve;}));
    render(<SettingsPage />);
    choose('tabStorage');
    fireEvent.change(await screen.findByDisplayValue('original-bucket'), {target:{value:'updated-bucket'}});
    fireEvent.click(screen.getByRole('button', {name:'saveConfig'}));
    await waitFor(() => expect(mocks.saveEnvConfig).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', {name:'saving'})).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', {name:'saving'}));
    expect(mocks.saveEnvConfig).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', {name:'bucketLabel'})).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole('button', {name:'saveConfig'})).toBeEnabled();
  });

  it('times out browser login and ignores an in-flight response after unmount', async () => {
    mocks.triggerMulerunLogin.mockResolvedValue({});
    const view = render(<SettingsPage />);
    choose('tabApikeys');
    await screen.findByLabelText('DashScope API Key');
    vi.useFakeTimers();
    await act(async () => fireEvent.click(screen.getByRole('button', {name:'mulerunLogin'})));
    expect(screen.getByRole('button', {name:'loginWaiting'})).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', {name:'loginWaiting'}));
    expect(mocks.triggerMulerunLogin).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    expect(screen.getByRole('alert')).toHaveTextContent('loginTimedOut');
    expect(screen.getByRole('button', {name:'mulerunLogin'})).toBeEnabled();
    let finish!: (value: object) => void;
    mocks.getEnvConfig.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    await act(async () => fireEvent.click(screen.getByRole('button', {name:'mulerunLogin'})));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    const calls = mocks.getEnvConfig.mock.calls.length;
    view.unmount();
    await act(async () => {finish(config); await vi.advanceTimersByTimeAsync(120000);});
    expect(mocks.getEnvConfig).toHaveBeenCalledTimes(calls);
  });
});
