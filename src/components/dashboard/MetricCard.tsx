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
      <div className="bg-[#111113] rounded-xl p-5 border border-[#1F1F23]/50 animate-pulse">
        <div className="h-4 w-32 bg-[#1F1F23]/60 rounded mb-4" />
        <div className="h-8 w-24 bg-[#1F1F23]/60 rounded mb-3" />
        <div className="h-3 w-28 bg-[#1F1F23]/40 rounded" />
      </div>
    );
  }

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;
  const trendNeutral = trend === undefined || trend === 0;

  return (
    <div className="bg-[#111113] rounded-xl p-5 border border-[#1F1F23]/50 hover:border-[#2A2A30]/50 transition-colors">
      <p className="text-[#A1A1AA] text-sm font-medium mb-2">{label}</p>
      <p className="text-white text-3xl font-bold tracking-tight mb-2">
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      {trend !== undefined && (
        <div className="flex items-center gap-1.5">
          {trendPositive && <TrendingUp className="w-4 h-4 text-emerald-400" />}
          {trendNegative && <TrendingDown className="w-4 h-4 text-red-400" />}
          {trendNeutral && <Minus className="w-4 h-4 text-[#71717A]" />}
          <span
            className={`text-xs font-medium ${
              trendPositive ? 'text-emerald-400' : trendNegative ? 'text-red-400' : 'text-[#71717A]'
            }`}
          >
            {trend > 0 ? '+' : ''}{trend} {trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}
