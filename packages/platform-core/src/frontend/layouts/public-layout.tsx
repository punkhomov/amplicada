import { Outlet } from 'react-router-dom';
import { LanguageSwitcher } from '../components/language-switcher.js';
import { ThemeSwitcher } from '../components/theme-switcher.js';

/**
 * Layout публичных страниц (вход, регистрация и т.п.): без навигации и меню — только
 * переключатели языка и темы в шапке, контент по центру.
 */
export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="shrink-0 border-b bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8">
          <div className="flex items-center justify-end h-14 gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <Outlet />
      </main>
    </div>
  );
}
