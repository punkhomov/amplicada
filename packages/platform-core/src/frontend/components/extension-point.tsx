import { useFrontendContext } from '../frontend-context.js';

interface ExtensionPointProps {
  id: string;
}

export function ExtensionPoint({ id }: ExtensionPointProps) {
  const { extensions } = useFrontendContext();
  const contributions = extensions.getAll(id);

  return (
    <>
      {contributions.map(c => (
        <c.component key={c.id} />
      ))}
    </>
  );
}
