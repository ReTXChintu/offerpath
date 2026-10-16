/**
 * @offerpath/ui: one look for web and desktop.
 *
 * Import the stylesheet once at the app's root:
 *   import '@offerpath/ui/styles.css';
 * then wrap the app in <UiProvider> (theme + toasts).
 */
export { cx } from './cx';
export {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
  type ResolvedTheme,
} from './theme';
export { UiProvider } from './provider';

export { Icon, ICON_NAMES, type IconName, type IconProps } from './components/Icon';
export { Logo } from './components/Logo';
export {
  Button,
  IconButton,
  Spinner,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
} from './components/Button';
export {
  Field,
  Input,
  PasswordInput,
  Textarea,
  Select,
  Checkbox,
  Switch,
  SegmentedControl,
  TagInput,
  LinesInput,
  type InputProps,
  type SelectProps,
} from './components/Form';
export {
  Badge,
  StatusBadge,
  Tag,
  Chips,
  BulletList,
  Kbd,
  Dot,
  Card,
  Panel,
  PageHeader,
  SectionHead,
  Stat,
  KeyValue,
  EmptyState,
  Alert,
  ProgressBar,
  SkillMeter,
  StatRow,
  MatchScore,
  CircularProgress,
  AiTag,
  metricColor,
  type BadgeVariant,
  type Tone,
  type TagTone,
  type DotTone,
  type CardProps,
  type StatTone,
  type AlertStatus,
} from './components/Display';
export { Dialog, DialogClose, ConfirmDialog, type DialogProps } from './components/Dialog';
export {
  Popover,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuSeparator,
  MenuLabel,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './components/Overlay';
export { Tooltip } from './components/Tooltip';
export { Toaster, toast, type ToastOptions, type ToastType } from './components/Toast';
export {
  Table,
  AppShell,
  Sidebar,
  SidebarBrand,
  NavGroup,
  NavItem,
  TopBar,
  StatusBar,
  StatusPill,
  type TableProps,
  type NavItemProps,
  type NavLinkProps,
} from './components/Layout';
export {
  CommandPalette,
  useCommandPaletteShortcut,
  type Command,
} from './components/CommandPalette';
export { ThemeToggle, ThemeSelect } from './components/ThemeToggle';
