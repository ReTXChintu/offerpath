import { useTheme, type ThemePreference } from '../theme';
import { IconButton } from './Button';
import { SegmentedControl } from './Form';
import { Menu, MenuLabel, MenuRadioGroup } from './Overlay';

const OPTIONS = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
] as const;

/** A top-bar button that picks the theme: system, light or dark. */
export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Menu
      label="Theme"
      trigger={
        <IconButton
          icon={resolved === 'dark' ? 'moon' : 'sun'}
          label={`Theme: ${preference === 'system' ? `system (${resolved})` : preference}`}
        />
      }
    >
      <MenuLabel>Theme</MenuLabel>
      <MenuRadioGroup<ThemePreference>
        value={preference}
        onChange={setPreference}
        options={OPTIONS}
      />
    </Menu>
  );
}

/** The same choice as a segmented control, for a settings page. */
export function ThemeSelect() {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl<ThemePreference>
      label="Theme"
      value={preference}
      onChange={setPreference}
      options={OPTIONS}
    />
  );
}
