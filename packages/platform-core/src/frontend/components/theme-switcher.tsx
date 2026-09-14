import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { type Theme, useTheme } from '../hooks/use-theme.js';
import { useTranslation } from '../lib/i18n.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.js';

const THEME_ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

const THEME_LABEL_KEYS: Record<Theme, 'theme_light' | 'theme_dark' | 'theme_system'> = {
  light: 'theme_light',
  dark: 'theme_dark',
  system: 'theme_system',
};

const THEME_OPTIONS: Theme[] = ['light', 'dark', 'system'];

export function ThemeSwitcher() {
  const { t } = useTranslation('core');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const CurrentIcon = theme === 'system' ? MonitorIcon : THEME_ICONS[resolvedTheme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted transition-colors cursor-pointer"
        aria-label="Theme"
      >
        <CurrentIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(option => {
          const Icon = THEME_ICONS[option];
          return (
            <DropdownMenuItem key={option} onClick={() => setTheme(option)} aria-pressed={option === theme}>
              <Icon className="size-4" />
              {t(THEME_LABEL_KEYS[option])}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
