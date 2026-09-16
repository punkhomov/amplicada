import type { ToolbarActionProps } from '@amplicada/module-admin/contracts';
import { DEFAULT_EXTENSION_KEY } from '@amplicada/platform-core/contracts';
import { useApiClient, useMutation, useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { useState } from 'react';

export function ChangePasswordAction({ documentType, editData: _editData, updateField }: ToolbarActionProps) {
  const { t } = useTranslation('auth-password');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const api = useApiClient();

  const hashMutation = useMutation({
    mutationFn: (password: string) => api.post<{ hash: string }>('/auth/hash-password', { password }),
    onSuccess: result => {
      updateField('auth-password', DEFAULT_EXTENSION_KEY, 'passwordHash', result.hash);
      setOpen(false);
      setPassword('');
    },
  });

  const handleConfirm = () => {
    if (!password) return;
    hashMutation.mutate(password);
  };

  if (documentType !== 'user') return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="lg" />}>{t('change_password_action')}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('change_password_title')}</DialogTitle>
          <DialogDescription>{t('change_password_description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-password">{t('change_password_field')}</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('change_password_placeholder')}
            />
          </div>
          {hashMutation.isError && <p className="text-sm text-destructive">{t('change_password_error')}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('core:common_cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!password || hashMutation.isPending}>
            {hashMutation.isPending ? t('change_password_pending') : t('core:common_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
