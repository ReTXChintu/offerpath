import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Alert,
  Button,
  CommandPalette,
  Field,
  IconButton,
  Input,
  MatchScore,
  Menu,
  MenuItem,
  StatusBadge,
  Switch,
  TagInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
} from '../index';

afterEach(() => {
  act(() => toast.clear());
});

describe('display', () => {
  it('StatusBadge shows its label', () => {
    render(<StatusBadge label="Awaiting approval" tone="accent" />);
    expect(screen.getByText('Awaiting approval')).toHaveClass('badge-primary');
  });

  it('MatchScore shows the percentage or a placeholder', () => {
    render(<MatchScore score={87} relevant />);
    expect(screen.getByText('87%')).toBeInTheDocument();
    render(<MatchScore score={null} />);
    expect(screen.getByText('Not analyzed')).toBeInTheDocument();
  });

  it('Alert reveals developer details on request', async () => {
    const user = userEvent.setup();
    render(
      <Alert status="error" title="Something went wrong" details="stack trace here">
        Claude could not start.
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Claude could not start.');
    expect(screen.queryByText('stack trace here')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show developer details' }));
    expect(screen.getByText('stack trace here')).toBeInTheDocument();
  });

  it('Button shows a busy state while loading', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('forms', () => {
  it('Field labels its control and describes it with the hint', () => {
    render(
      <Field label="Email" hint="We never share it.">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('We never share it.');
  });

  it('Switch toggles', async () => {
    const user = userEvent.setup();
    function Owner() {
      const [on, setOn] = useState(false);
      return (
        <Switch checked={on} onCheckedChange={setOn}>
          Produce PDF
        </Switch>
      );
    }
    render(<Owner />);
    const sw = screen.getByRole('switch', { name: 'Produce PDF' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('TagInput adds on Enter and removes with its button', async () => {
    const user = userEvent.setup();
    function Owner() {
      const [tags, setTags] = useState<string[]>(['React']);
      return <TagInput value={tags} onChange={setTags} aria-label="Skills" />;
    }
    render(<Owner />);
    await user.type(screen.getByLabelText('Skills'), 'Node.js{Enter}');
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(screen.queryByText('React')).not.toBeInTheDocument();
  });
});

describe('primitives', () => {
  it('Tabs switch content', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabsList label="Sections">
          <TabsTrigger value="a">Activity</TabsTrigger>
          <TabsTrigger value="b" count={3}>
            Runs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">Live feed</TabsContent>
        <TabsContent value="b">Run list</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Live feed')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: /Runs/ }));
    expect(screen.getByText('Run list')).toBeVisible();
    expect(screen.getByRole('tab', { name: /Runs/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Menu opens from the keyboard and runs an item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu trigger={<IconButton icon="more" label="More actions" tooltip={false} />}>
        <MenuItem onSelect={onSelect}>Export logs</MenuItem>
      </Menu>,
    );
    screen.getByRole('button', { name: 'More actions' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Export logs' }));
    expect(onSelect).toHaveBeenCalled();
  });

  it('toast() shows a message in the Toaster', async () => {
    render(<Toaster />);
    act(() => {
      toast.show({
        type: 'info',
        title: 'Queued (#2)',
        description: 'Starts when the agent is free.',
      });
    });
    expect(await screen.findByText('Queued (#2)')).toBeInTheDocument();
    expect(screen.getByText('Starts when the agent is free.')).toBeInTheDocument();
  });

  it('CommandPalette filters and runs the chosen command', async () => {
    const user = userEvent.setup();
    const goJobs = vi.fn();
    const goAgent = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={() => undefined}
        commands={[
          { id: 'jobs', label: 'Jobs', group: 'Hunt', onSelect: goJobs },
          { id: 'agent', label: 'Agent', group: 'App', keywords: 'queue logs', onSelect: goAgent },
        ]}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'queue');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(goAgent).toHaveBeenCalled();
    expect(goJobs).not.toHaveBeenCalled();
  });
});
