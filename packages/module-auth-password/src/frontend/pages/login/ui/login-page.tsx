import { ApiError, AUTH_REDIRECT_KEY, useApiClient, useMutation, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@amplicada/platform-core/frontend/ui/card';
import { Field, FieldContent, FieldError, FieldLabel } from '@amplicada/platform-core/frontend/ui/field';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function resolveRedirect(): string {
  const fromSession = sessionStorage.getItem(AUTH_REDIRECT_KEY);
  if (fromSession) {
    sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    return fromSession;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect') || '/home';
}

export function LoginPage() {
  const { t } = useTranslation('auth-password');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [redirectTo] = useState(() => resolveRedirect());

  const mutation = useMutation({
    mutationFn: (credentials: { login: string; password: string }) => api.post('/auth/login', credentials),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      navigate(redirectTo, { replace: true });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ login, password });
  };

  const error = mutation.isError
    ? mutation.error instanceof ApiError && mutation.error.status === 401
      ? t('login_error_invalid')
      : t('login_error_server')
    : '';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl text-center">{t('login_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={mutation.isPending} className="space-y-4">
            <Field>
              <FieldLabel>{t('login_field_login')}</FieldLabel>
              <FieldContent>
                <Input type="text" value={login} onChange={e => setLogin(e.target.value)} required />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>{t('login_field_password')}</FieldLabel>
              <FieldContent>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </FieldContent>
            </Field>

            {error && <FieldError>{error}</FieldError>}

            <Button type="submit" className="w-full">
              {mutation.isPending ? t('login_submit_pending') : t('login_submit')}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
