import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@amplicada/platform-core/frontend/ui/chart';
import { CartesianGrid, Line, LineChart, XAxis } from 'recharts';

export interface ChartPoint {
  t: string;
  v: number;
}

function formatTick(value: string): string {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' });
}

/** Линейный тренд по точкам серии (время/значение) на вендоренном `ui/chart`. */
export function TrendChart({ points, label }: { points: ChartPoint[]; label: string }) {
  const data = points.map(point => ({ time: formatTick(point.t), value: point.v }));
  const config = { value: { label, color: 'var(--chart-1)' } } satisfies ChartConfig;

  if (data.length === 0) {
    return <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">—</div>;
  }

  return (
    <ChartContainer config={config} className="h-32 w-full">
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  );
}
