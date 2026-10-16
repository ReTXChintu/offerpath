import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button, ConfirmDialog, Dialog } from '../index';

describe('Dialog', () => {
  it('opens from its trigger and closes with the close button', async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="Apply from a link" trigger={<Button>Open</Button>}>
        <p>Paste the job posting link.</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply from a link' });
    expect(dialog).toHaveTextContent('Paste the job posting link.');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and reports it to a controlled owner', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function Owner() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          title="Settings"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        />
      );
    }
    render(<Owner />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('runs the confirm action and cancels without it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Approve and apply?"
        description="Offerpath will fill the form in Chrome."
        confirmLabel="Approve & Apply"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Approve and apply?' })).toHaveAccessibleDescription(
      'Offerpath will fill the form in Chrome.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Approve & Apply' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while loading', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Reject?"
        confirmLabel="Reject"
        destructive
        loading
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });
});
