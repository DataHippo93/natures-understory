'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceArea,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface SparklinePoint {
  t: string; // ISO timestamp
  temp: number;
}

interface CoolerSparklineProps {
  readings: SparklinePoint[];
  minF: number;
  maxF: number;
  color: string;
}

export function CoolerSparkline({ readings, minF, maxF, color }: CoolerSparklineProps) {
  if (readings.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Collecting history…
      </div>
    );
  }

  const data = readings.map((r) => ({
    ...r,
    label: new Date(r.t).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }),
  }));

  const temps = data.map((d) => d.temp);
  const yMin = Math.floor(Math.min(...temps, minF) - 2);
  const yMax = Math.ceil(Math.max(...temps, maxF) + 2);

  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <YAxis domain={[yMin, yMax]} hide />
          {/* Acceptable band */}
          <ReferenceArea y1={minF} y2={maxF} fill="rgba(122,170,98,0.10)" stroke="rgba(122,170,98,0.25)" strokeDasharray="2 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { label: string; temp: number };
              return (
                <div
                  className="rounded px-2 py-1 text-[10px] shadow-lg"
                  style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}
                >
                  {d.label}: <span style={{ color, fontWeight: 700 }}>{d.temp.toFixed(1)}°F</span>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="temp"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
