import { Link } from 'react-router-dom';
import { useFrontendContext } from '../frontend-context.js';

export function Navigation() {
  const { navigation } = useFrontendContext();
  const items = navigation.getAll();

  return (
    <nav className="flex gap-4">
      {items.map(item => (
        <Link key={item.id} to={item.path} className="text-sm font-medium text-gray-700 hover:text-gray-900">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
