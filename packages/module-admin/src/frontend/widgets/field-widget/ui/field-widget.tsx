import type { FieldMetadata } from '@amplicada/platform-core/contracts';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Calendar } from '@amplicada/platform-core/frontend/ui/calendar';
import { Checkbox } from '@amplicada/platform-core/frontend/ui/checkbox';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@amplicada/platform-core/frontend/ui/popover';
import { RadioGroup, RadioGroupItem } from '@amplicada/platform-core/frontend/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';

interface FieldWidgetProps {
  fieldKey: string;
  meta: FieldMetadata;
  value: unknown;
  readonly?: boolean;
  onChange?: (value: unknown) => void;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function FieldWidget({ fieldKey: _fieldKey, meta, value, readonly, onChange }: FieldWidgetProps) {
  const disabled = readonly || meta.readonly;

  const handleChange = (newValue: unknown) => {
    onChange?.(newValue);
  };

  let input: React.ReactNode;

  switch (meta.widget) {
    case 'select':
      input = (
        <Select value={String(value ?? '')} onValueChange={handleChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {meta.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'switch':
      input = (
        <div className="flex items-center gap-2">
          <Switch checked={!!value} onCheckedChange={handleChange} disabled={disabled} />
          {meta.helpText && <span className="text-xs text-muted-foreground">{meta.helpText}</span>}
        </div>
      );
      break;
    case 'radiobutton':
      input = (
        <RadioGroup value={String(value ?? '')} onValueChange={handleChange} disabled={disabled}>
          {meta.options?.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value={opt.value} disabled={disabled} />
              {opt.label}
            </label>
          ))}
        </RadioGroup>
      );
      break;
    case 'checkbox':
      input = <Checkbox checked={!!value} onCheckedChange={handleChange} disabled={disabled} />;
      break;
    case 'date':
      input = (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" className="w-full justify-start font-normal">
                {value ? fmtDate(new Date(String(value) + 'T00:00:00')) : <span className="text-muted-foreground">—</span>}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value ? new Date(String(value) + 'T00:00:00') : undefined}
              onSelect={(d: Date | undefined) => handleChange(d ? fmtDate(d) : null)}
            />
          </PopoverContent>
        </Popover>
      );
      break;
    case 'datetime': {
      const dateObj = value ? new Date(String(value)) : null;
      input = (
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" className="flex-1 justify-start font-normal">
                  {dateObj ? fmtDate(dateObj) : <span className="text-muted-foreground">—</span>}
                </Button>
              }
            />
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateObj ?? undefined}
                onSelect={(d: Date | undefined) => {
                  if (!d) return;
                  const merged = dateObj ?? new Date();
                  merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  handleChange(merged.toISOString());
                }}
              />
            </PopoverContent>
          </Popover>
          <Input
            type="time"
            step="1"
            value={dateObj ? fmtTime(dateObj) : ''}
            className="w-32"
            disabled={disabled}
            onChange={e => {
              if (!e.target.value) return;
              const [h, m, s] = e.target.value.split(':').map(Number);
              const merged = dateObj ?? new Date();
              merged.setHours(h ?? 0, m ?? 0, s ?? 0);
              handleChange(merged.toISOString());
            }}
          />
        </div>
      );
      break;
    }
    case 'number':
      input = (
        <Input
          type="number"
          value={String(value ?? '')}
          readOnly={disabled}
          placeholder={meta.placeholder}
          onChange={e => handleChange(e.target.value)}
        />
      );
      break;
    case 'password':
      input = (
        <Input
          type="password"
          value={String(value ?? '')}
          readOnly={disabled}
          placeholder={meta.placeholder}
          onChange={e => handleChange(e.target.value)}
        />
      );
      break;
    default:
      input = (
        <Input
          type="text"
          value={String(value ?? '')}
          readOnly={disabled}
          placeholder={meta.placeholder}
          onChange={e => handleChange(e.target.value)}
        />
      );
  }

  return (
    <div>
      <Label className="mb-1 block">{meta.label}</Label>
      {input}
      {meta.helpText && <p className="text-xs text-muted-foreground mt-1">{meta.helpText}</p>}
    </div>
  );
}
