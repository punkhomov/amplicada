import { CircleFlag } from 'react-circle-flags';
import { useTranslation } from '../lib/i18n.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.js';

const LANGUAGE_FLAGS: Record<string, string> = {
  ru: 'ru',
  en: 'gb',
};

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const languages = Object.keys(i18n.options.resources ?? {});
  if (languages.length < 2) return null;

  const current = i18n.resolvedLanguage ?? languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted transition-colors cursor-pointer"
        aria-label="Language"
      >
        <span className="flex size-5 shrink-0 overflow-hidden rounded-full">
          <CircleFlag countryCode={LANGUAGE_FLAGS[current] ?? current} height="20" width="20" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map(lng => (
          <DropdownMenuItem key={lng} onClick={() => i18n.changeLanguage(lng)} aria-pressed={lng === current}>
            <span className="flex size-4 shrink-0 overflow-hidden rounded-full">
              <CircleFlag countryCode={LANGUAGE_FLAGS[lng] ?? lng} height="16" width="16" />
            </span>
            {LANGUAGE_NAMES[lng] ?? lng}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
