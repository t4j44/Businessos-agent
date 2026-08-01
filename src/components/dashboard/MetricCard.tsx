import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  prefix?: string;
  suffix?: string;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  trend,
  trendLabel = 'vs last week',
  prefix = '',
  suffix = '',
  loading = false,
}: MetricCardProps) {
  if (loading) {
    return (
      <div className="bg-[#1E293B] rounded-xl p-5 border border-slate-700/50 animate-pulse">
        <div className="h-4 w-32 bg-slate-700/60 rounded mb-4" />
        <div className="h-8 w-24 bg-slate-700/60 rounded mb-3" />
        <div className="h-3 w-28 bg-slate-700/40 rounded" />
      </div>
    );
  }

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;
  const trendNeutral = trend === undefined || trend === 0;

  return (
    <div className="bg-[#1E293B] rounded-xl p-5 border border-slate-700/50 hover:border-slate-600/50 transition-colors">
      <p className="text-slate-400 text-sm font-medium mb-2">{label}</p>
      <p className="text-white text-3xl font-bold tracking-tight mb-2">
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      {trend !== undefined && (
        <div className="flex items-center gap-1.5">
          {trendPositive && <TrendingUp className="w-4 h-4 text-emerald-400" />}
          {trendNegative && <TrendingDown className="w-4 h-4 text-red-400" />}
          {trendNeutral && <Minus className="w-4 h-4 text-slate-500" />}
          <span
            className={`text-xs font-medium ${
              trendPositive ? 'text-emerald-400' : trendNegative ? 'text-red-400' : 'text-slate-500'
            }`}
          >
            {trend > 0 ? '+' : ''}{trend} {trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}
