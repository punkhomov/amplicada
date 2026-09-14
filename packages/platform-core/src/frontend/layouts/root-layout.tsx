import { Outlet } from 'react-router-dom';
import { RouteProgressBar } from '../components/route-progress-bar.js';

export function RootLayout() {
  return (
    <>
      <RouteProgressBar />
      <Outlet />
    </>
  );
}
