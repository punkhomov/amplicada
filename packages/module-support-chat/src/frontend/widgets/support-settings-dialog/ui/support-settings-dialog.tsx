import { useApiClient, useMutation, useQuery, useQueryClient, useTranslation } from '@amplicada/platform-core/frontend';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@amplicada/platform-core/frontend/ui/dialog';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Skeleton } from '@amplicada/platform-core/frontend/ui/skeleton';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { useEffect, useState } from 'react';
import {
  SUPPORT_AI_PROVIDERS,
  type SupportAiProvider,
  type SupportSettingsDto,
  type SupportSettingsPatch,
} from '../../../../contracts/index.js';
import { supportChatQueryKeys, supportChatSettingsQueryOptions } from '../../../lib/query-options.js';

/** Настройки поддержки: пока секция AI-провайдера — конфиг уже сохраняется, ответчик появится позже. */
export function SupportSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('support-chat');
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { data } = useQuery(supportChatSettingsQueryOptions(api));
  const [form, setForm] = useState<SupportSettingsDto | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: SupportSettingsPatch) => api.patch<SupportSettingsDto>('/support-chat/admin/settings', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supportChatQueryKeys.settings });
      onOpenChange(false);
    },
  });

  const patch = (values: Partial<SupportSettingsDto>) => setForm(previous => (previous ? { ...previous, ...values } : previous));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin_settings_title')}</DialogTitle>
          <DialogDescription>{t('admin_settings_subtitle')}</DialogDescription>
        </DialogHeader>

        {form ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">{t('admin_settings_ai_title')}</p>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t('admin_settings_ai_enabled')}</span>
              <Switch
                checked={form.aiEnabled}
                onCheckedChange={checked => patch({ aiEnabled: checked })}
                aria-label={t('admin_settings_ai_enabled')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('admin_settings_provider')}</span>
              <Select
                value={form.aiProvider ?? 'none'}
                onValueChange={value => patch({ aiProvider: value === 'none' ? null : (value as SupportAiProvider) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('admin_settings_provider_none')}</SelectItem>
                  {SUPPORT_AI_PROVIDERS.map(provider => (
                    <SelectItem key={provider} value={provider}>
                      {t(`provider_${provider}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('admin_settings_model')}</span>
              <Input
                value={form.aiModel ?? ''}
                placeholder={t('admin_settings_model_placeholder')}
                onChange={event => patch({ aiModel: event.target.value || null })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('admin_settings_prompt')}</span>
              <Textarea
                rows={3}
                value={form.aiSystemPrompt ?? ''}
                placeholder={t('admin_settings_prompt_placeholder')}
                onChange={event => patch({ aiSystemPrompt: event.target.value || null })}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('admin_settings_cancel')}
          </Button>
          <Button
            disabled={!form || save.isPending}
            onClick={() =>
              form &&
              save.mutate({
                aiEnabled: form.aiEnabled,
                aiProvider: form.aiProvider,
                aiModel: form.aiModel,
                aiSystemPrompt: form.aiSystemPrompt,
              })
            }
          >
            {t('admin_settings_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
