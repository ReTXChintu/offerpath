import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

// ---- Popover ----------------------------------------------------------------------------

/** A floating panel anchored to its trigger (Radix Popover). */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'end',
  width,
  label,
}: {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  width?: number;
  /** Accessible name for the panel. */
  label?: string;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="popover"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          style={width ? { width } : undefined}
          aria-label={label}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ---- Menu -------------------------------------------------------------------------------

/** A dropdown menu of actions (Radix DropdownMenu): arrow keys, typeahead, Escape. */
export function Menu({
  trigger,
  children,
  align = 'end',
  label,
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  label?: string;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          className="menu"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export function MenuItem({
  children,
  icon,
  onSelect,
  disabled,
  danger,
}: {
  children: ReactNode;
  icon?: IconName;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      className={cx('menu-item', danger && 'danger')}
      onSelect={onSelect}
      disabled={disabled}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </MenuPrimitive.Item>
  );
}

/** A choice among several, shown with a check on the current one. */
export function MenuRadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; icon?: IconName }[];
}) {
  return (
    <MenuPrimitive.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <MenuPrimitive.RadioItem key={o.value} value={o.value} className="menu-item">
          {o.icon ? <Icon name={o.icon} size={15} /> : null}
          <span className="flex-1">{o.label}</span>
          <MenuPrimitive.ItemIndicator>
            <Icon name="check" size={14} />
          </MenuPrimitive.ItemIndicator>
        </MenuPrimitive.RadioItem>
      ))}
    </MenuPrimitive.RadioGroup>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <MenuPrimitive.Label className="menu-label">{children}</MenuPrimitive.Label>;
}

// ---- Tabs -------------------------------------------------------------------------------

const TabsVariant = createContext<'line' | 'pill'>('line');

/**
 * Tabs (Radix Tabs): arrow keys move between tabs. `variant="pill"` is the
 * compact segmented look used for list filters.
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      className={className}
    >
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabsList({
  children,
  variant = 'line',
  label,
  className,
}: {
  children: ReactNode;
  variant?: 'line' | 'pill';
  label?: string;
  className?: string;
}) {
  return (
    <TabsVariant.Provider value={variant}>
      <TabsPrimitive.List
        className={cx(variant === 'pill' ? 'pill-tabs' : 'tabs', className)}
        aria-label={label}
      >
        {children}
      </TabsPrimitive.List>
    </TabsVariant.Provider>
  );
}

export function TabsTrigger({
  value,
  children,
  count,
  disabled,
}: {
  value: string;
  children: ReactNode;
  count?: number;
  disabled?: boolean;
}) {
  const variant = useContext(TabsVariant);
  return (
    <TabsPrimitive.Trigger
      value={value}
      disabled={disabled}
      className={variant === 'pill' ? 'pill-tab' : 'tab'}
    >
      {children}
      {count !== undefined ? <span className="tab-count">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content value={value} className={cx('tabs-content', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
