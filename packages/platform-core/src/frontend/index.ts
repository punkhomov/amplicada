export type {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
export {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
export type {
  ExtensionContribution,
  FrontendExtensionPointRegistry,
  FrontendLayoutRegistry,
  FrontendModule,
  FrontendModuleRegistry,
  FrontendNavigationRegistry,
  FrontendRouteDefinition,
  FrontendRouteRegistry,
  FrontendSetupContext,
  FrontendSlotRegistry,
  NavigationItem,
  RegisteredModule,
} from '../contracts/frontend/index.js';
export type { FrontendApp } from './app.js';
export { bootstrapFrontend, createFrontendApp, FrontendProvider, useFrontendContext } from './app.js';
export { ExtensionPoint } from './components/extension-point.js';
export { LanguageSwitcher } from './components/language-switcher.js';
export { buildModuleRouteTree } from './components/module-routes.js';
export { Navigation } from './components/navigation.js';
export { QueryError } from './components/query-error.js';
export { RouteError } from './components/route-error.js';
export { RouteProgressBar } from './components/route-progress-bar.js';
export { Slot } from './components/slot.js';
export { ThemeSwitcher } from './components/theme-switcher.js';
export { useApiClient } from './hooks/use-api-client.js';
export { useAuthContext } from './hooks/use-auth-context.js';
export { useCurrentUser } from './hooks/use-current-user.js';
export { useLocalStorage } from './hooks/use-local-storage.js';
export { useLogout } from './hooks/use-logout.js';
export { useRequireAuth } from './hooks/use-require-auth.js';
export { useSwipeSelect } from './hooks/use-swipe-select.js';
export type { ResolvedTheme, Theme, UseThemeResult } from './hooks/use-theme.js';
export { useTheme } from './hooks/use-theme.js';
export { AppLayout } from './layouts/app-layout.js';
export { PublicLayout } from './layouts/public-layout.js';
export { RootLayout } from './layouts/root-layout.js';
export { resolveApiBaseUrl } from './lib/api-base-url.js';
export {
  API_CLIENT_TOKEN,
  type ApiClient,
  ApiError,
  type ApiRequestOptions,
  createApiClient,
} from './lib/api-client.js';
export { AUTH_REDIRECT_KEY, redirectToLogin } from './lib/auth-redirect.js';
export { createI18n, i18n, type LocaleResources, Trans, useTranslation } from './lib/i18n.js';
export { createQueryClient } from './lib/query-client.js';
export { getErrorMessage } from './lib/query-error.js';
export { cn } from './lib/utils.js';
