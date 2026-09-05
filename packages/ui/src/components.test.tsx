import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Button, Checkbox, PasswordField, TextField } from './index';

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
