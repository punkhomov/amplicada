import { LanguageSwitcher, ThemeSwitcher, useLogout, useRequireAuth, useTranslation } from '@amplicada/platform-core/frontend';
import { Avatar, AvatarImage } from '@amplicada/platform-core/frontend/ui/avatar';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { ButtonGroup } from '@amplicada/platform-core/frontend/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@amplicada/platform-core/frontend/ui/dropdown-menu';
import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { type AdminHeaderApi, AdminHeaderContext, type AdminHeaderRender } from '../lib/admin-header.js';

interface SectionTab {
  id: string;
  labelKey: string;
  path: string;
  disabled?: boolean;
}

const SECTION_TABS: SectionTab[] = [
  { id: 'data', labelKey: 'admin_tab_data', path: '/admin' },
  { id: 'apps', labelKey: 'admin_tab_apps', path: '/admin/apps' },
];

function generateAvatarUrl(login: string): string {
  const hue = Array.from(login).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="hsl(${hue},50%,45%)"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" font-weight="600">${login[0].toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function AdminLayout() {
  const { t } = useTranslation('admin');
  const { user, loading } = useRequireAuth();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  // Функцию рендера храним в обёртке: React трактует голую функцию в useState как updater.
  const [header, setHeader] = useState<{ render: AdminHeaderRender } | null>(null);
  const headerApi = useMemo<AdminHeaderApi>(() => ({ setHeader: render => setHeader(render ? { render } : null) }), []);

  const activeSection =
    SECTION_TABS.slice()
      .sort((a, b) => b.path.length - a.path.length)
      .find(tab => location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`))?.id ?? 'data';

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('core:loading')}</div>;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex min-w-0 items-center gap-4">
              {header ? (
                header.render()
              ) : (
                <>
                  <span className="text-lg font-semibold">{t('admin_title')}</span>
                  <ButtonGroup>
                    {SECTION_TABS.map(tab => (
                      <Button
                        key={tab.id}
                        size="sm"
                        variant={activeSection === tab.id ? 'default' : 'outline'}
                        disabled={tab.disabled}
                        onClick={() => navigate(tab.path)}
                      >
                        {t(tab.labelKey)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </>
              )}
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
                    {t('admin_logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <AdminHeaderContext.Provider value={headerApi}>
        <main className="flex-1 min-h-0">
          <Outlet />
        </main>
      </AdminHeaderContext.Provider>
      <footer className="shrink-0 border-t bg-background">
        <div className="w-full max-w-screen-2xl mx-auto px-8">
          <span className="text-muted-foreground font-mono">built with Amplicada</span>
        </div>
      </footer>
    </div>
  );
}
