import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ActionMenu, Dialog, LoadingState, Skeleton, Button, Checkbox, PasswordField, TextField } from './index';

afterEach(cleanup);

it('retains native form validation, labels, descriptions, input refs and change values', () => {
  const onChange = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  render(<TextField label="邮箱" name="email" type="email" isRequired description="接收项目通知" inputRef={inputRef} onChange={onChange} />);
  const input = screen.getByLabelText('邮箱') as HTMLInputElement;
  expect(inputRef.current).toBe(input);
  expect(input.required).toBe(true);
  expect(input.type).toBe('email');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('接收项目通知');
  fireEvent.change(input, { target: { value: 'creator@example.com' } });
  expect(onChange).toHaveBeenCalledWith('creator@example.com');
});

it('toggles password visibility without submitting or losing the value', () => {
  const onSubmit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={onSubmit}><PasswordField label="密码" defaultValue="test-password" showPasswordLabel="显示密码" hidePasswordLabel="隐藏密码" /></form>);
  const input = screen.getByLabelText('密码') as HTMLInputElement;
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  expect(input.type).toBe('text');
  expect(input.value).toBe('test-password');
  expect(screen.getByRole('button', { name: '隐藏密码' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }));
  expect(input.type).toBe('password');
  expect(onSubmit).not.toHaveBeenCalled();
});

it('blocks disabled and pending actions and shows linked field errors', () => {
  const onPress = vi.fn();
  render(<><Button isPending onPress={onPress}>生成中</Button><Button isDisabled onPress={onPress}>生成</Button><TextField label="项目名称" isInvalid errorMessage="请输入项目名称" /></>);
  fireEvent.click(screen.getByRole('button', { name: '生成中' }));
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  expect(onPress).not.toHaveBeenCalled();
  const input = screen.getByLabelText('项目名称');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')?.split(' ').some(id => document.getElementById(id)?.textContent === '请输入项目名称')).toBe(true);
});

it('preserves checkbox values and prevents disabled password toggles', () => {
  const onChange = vi.fn();
  render(<><Checkbox onChange={onChange}>保留原始素材</Checkbox><PasswordField label="密码" isDisabled showPasswordLabel="显示密码" hidePasswordLabel="隐藏密码" /></>);
  fireEvent.click(screen.getByRole('checkbox', { name: '保留原始素材' }));
  expect(onChange).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  expect((screen.getByLabelText('密码') as HTMLInputElement).type).toBe('password');
});

it('announces loading once while skeleton shapes stay decorative', () => {
  render(<><LoadingState label="正在加载项目" inline /><Skeleton /><Skeleton /></>);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('正在加载项目');
  expect(document.querySelectorAll('.omni-skeleton[aria-hidden="true"]')).toHaveLength(2);
});

it('keeps a controlled dialog open during submission and allows dismissal afterwards', () => {
  const change = vi.fn();
  const { rerender } = render(<Dialog isOpen onOpenChange={change} title="保存项目" closeLabel="关闭" isDismissable={false}><p>正在保存</p></Dialog>);
  expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(change).not.toHaveBeenCalled();
  rerender(<Dialog isOpen onOpenChange={change} title="保存项目" closeLabel="关闭"><p>已保存</p></Dialog>);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(change).toHaveBeenCalledWith(false);
});

it('action menus preserve labels, disabled actions and Escape dismissal', async () => {
  const action = vi.fn();
  render(<ActionMenu label="创建" items={[{ id: 'series', label: '系列', onAction: action }, { id: 'import', label: '导入', isDisabled: true, onAction: action }]} />);
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  const item = await screen.findByRole('menuitem', { name: '系列' });
  expect(screen.getByRole('menuitem', { name: '导入' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(item);
  expect(action).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  const menu = await screen.findByRole('menu');
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});
