import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field, PasswordInput } from '../index';

describe('PasswordInput', () => {
  it('hides the password and offers a "Show password" button', () => {
    render(
      <Field label="Password">
        <PasswordInput defaultValue="hunter22" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  });

  it('toggles between showing and hiding, with matching labels', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Password">
        <PasswordInput defaultValue="hunter22" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');

    await user.click(hide);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps what was typed when toggled', async () => {
    const user = userEvent.setup();
    render(
      <Field label="API key">
        <PasswordInput />
      </Field>,
    );
    const input = screen.getByLabelText('API key');
    await user.type(input, 's3cret');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveValue('s3cret');
  });
});
