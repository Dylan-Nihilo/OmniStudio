import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/renderWithIntl';
import VoiceCloneModal from './VoiceCloneModal';
import VoiceDesignModal from './VoiceDesignModal';
import { useState } from 'react';
const mocks=vi.hoisted(()=>({upload:vi.fn(),clone:vi.fn(),preview:vi.fn()}));
vi.mock('@/lib/api',()=>({api:{uploadFile:mocks.upload,cloneVoice:mocks.clone,designVoicePreview:mocks.preview}}));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (url: string) => url }));

it('keeps a clone form after failure, prevents duplicate submission and guards dirty close', async()=>{
 const close=vi.fn(); let reject!:(e:Error)=>void;
 mocks.upload.mockResolvedValue({url:'/sample.wav'});
 mocks.clone.mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));
 renderWithIntl(<VoiceCloneModal isOpen seriesId="series" onClose={close} onCreated={vi.fn()} />);
 fireEvent.change(document.querySelector('input[type=file]')!,{target:{files:[new File(['sample'],'sample.wav',{type:'audio/wav'})]}});
 fireEvent.click(screen.getByRole('button',{name:'开始复刻'}));
 fireEvent.click(screen.getByRole('button',{name:'开始复刻'}));
 await waitFor(()=>expect(mocks.clone).toHaveBeenCalledOnce());
 await act(async()=>{reject(new Error('offline'));});
 expect(await screen.findByRole('alert')).toHaveTextContent('offline');
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(await screen.findByRole('dialog',{name:'有未保存的修改'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));
 expect(screen.getByDisplayValue('sample')).toBeVisible();
 expect(close).not.toHaveBeenCalled();
});

it('retains the voice design prompt after preview failure and protects it on close',async()=>{
 mocks.preview.mockRejectedValue(new Error('provider busy'));
 const close=vi.fn(); renderWithIntl(<VoiceDesignModal isOpen seriesId="series" onClose={close} onCreated={vi.fn()} />);
 fireEvent.change(screen.getByRole('textbox',{name:'音色描述（100-500 字中文）'}),{target:{value:'a calm voice'}});
 fireEvent.click(screen.getByRole('button',{name:'生成试听'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('provider busy');
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(await screen.findByRole('dialog',{name:'有未保存的修改'})).toBeVisible();
 expect(close).not.toHaveBeenCalled();
});

it('keeps a late voice preview without playing audio after leaving', async () => {
 let resolve!: (value: any) => void;
 mocks.preview.mockImplementation(() => new Promise(r => { resolve = r; }));
 const play = vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('Audio', class { play = play; pause = vi.fn(); });
 const props = { seriesId: 'series', onClose: vi.fn(), onCreated: vi.fn() };
 function Harness() { const [open, setOpen] = useState(true); return <><button onClick={() => setOpen(false)}>leave test</button><VoiceDesignModal isOpen={open} {...props} /></>; }
 renderWithIntl(<Harness />);
 fireEvent.change(screen.getByRole('textbox', { name: '音色描述（100-500 字中文）' }), { target: { value: 'calm voice' } });
 fireEvent.click(screen.getByRole('button', { name: '生成试听' }));
 fireEvent.click(screen.getByText('leave test'));
 await act(async () => { resolve({ voice_id: 'voice', preview_url: '/voice.wav' }); });
 expect(play).not.toHaveBeenCalled();
 vi.unstubAllGlobals();
});
