import { useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  login: string;
}

export function HomePage() {
  const { t } = useTranslation('core');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ user: User }>('/auth/me'),
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      navigate('/login');
    },
  });

  if (isLoading) {
    return <div className="text-muted-foreground">{t('loading')}</div>;
  }

  const user = data?.user;

  return (
    <div className="w-full max-w-md bg-background rounded-lg shadow-md p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">{t('home_title')}</h1>
      <p className="text-muted-foreground mb-6">
        {t('home_greeting_prefix')} <span className="font-medium">{user?.login}</span>
      </p>
      <button
        type="button"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        className="w-full bg-destructive text-white py-2 rounded-md hover:bg-destructive/80"
      >
        {logoutMutation.isPending ? t('home_logout_pending') : t('home_logout')}
      </button>
    </div>
  );
}
