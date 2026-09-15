import { useLogout, useRequireAuth } from '@amplicada/platform-core/frontend';
import { Avatar, AvatarImage } from '@amplicada/platform-core/frontend/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@amplicada/platform-core/frontend/ui/dropdown-menu';
import { Outlet } from 'react-router-dom';
import { ExtensionPoint } from '../components/extension-point.js';
import { LanguageSwitcher } from '../components/language-switcher.js';
import { Navigation } from '../components/navigation.js';
import { ThemeSwitcher } from '../components/theme-switcher.js';

function generateAvatarUrl(login: string): string {
  const hue = Array.from(login).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="hsl(${hue},50%,45%)"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" font-weight="600">${login[0].toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function AppLayout() {
  const { user, loading } = useRequireAuth();
  const logout = useLogout();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Загрузка...</div>;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <ExtensionPoint id="header" />
              <Navigation />
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeSwitcher />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 -mr-2 outline-none hover:bg-muted transition-colors cursor-pointer">
                  <span className="text-sm text-muted-foreground">{user?.login}</span>
                  <Avatar size="sm">
                    <AvatarImage src={generateAvatarUrl(user?.login ?? '?')} />
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => logout.mutate()}>
                    Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
