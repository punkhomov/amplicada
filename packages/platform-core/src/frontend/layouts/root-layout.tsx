import { Outlet } from 'react-router-dom';
import { ExtensionPoint } from '../components/extension-point.js';
import { RouteProgressBar } from '../components/route-progress-bar.js';

export function RootLayout() {
  return (
    <>
      <RouteProgressBar />
      <Outlet />
      <ExtensionPoint id="floating" />
    </>
  );
}
