"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from "recharts";

export type SectorTrendPoint = {
  year: number;
  general: number;
  social: number;
  economic: number;
  other: number;
};

type LineTrendsCardProps = {
  subtitle: string;
  data: SectorTrendPoint[];
};

const SERIES_META: Array<{ key: keyof Omit<SectorTrendPoint, "year">; label: string; color: string }> = [
  { key: "general", label: "General Services", color: "#60A5FA" },
  { key: "social", label: "Social Services", color: "#34D399" },
  { key: "economic", label: "Economic Services", color: "#22D3EE" },
  { key: "other", label: "Other Services", color: "#F59E0B" },
];

export default function LineTrendsCard({ subtitle, data }: LineTrendsCardProps) {
  const [activeSeriesName, setActiveSeriesName] = useState<string | null>(null);
  const formatTooltipValue = (value: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Card className="rounded-2xl border border-[#033a58] bg-[#022437] text-white shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg text-white">Sectoral Budget Trends Over Time</CardTitle>
        <p className="text-sm text-cyan-100/80">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="h-[360px] w-full">
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(226, 232, 240, 0.18)" />
                <XAxis
                  dataKey="year"
                  tickLine={false}
                  axisLine={{ stroke: "rgba(241, 245, 249, 0.35)" }}
                  tick={{ fill: "rgba(241, 245, 249, 0.85)", fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={{ stroke: "rgba(241, 245, 249, 0.35)" }}
                  tick={{ fill: "rgba(241, 245, 249, 0.85)", fontSize: 12 }}
                  tickFormatter={(value: number) => `PHP ${Math.round(value / 1_000_000)}M`}
                />
                <Tooltip
                  cursor={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length || !activeSeriesName) {
                      return null;
                    }

                    const activePayload = payload.find(
                      (entry) => entry.name === activeSeriesName
                    );

                    if (!activePayload || typeof activePayload.value !== "number") {
                      return null;
                    }

                    return (
                      <div className="rounded-lg border border-white/15 bg-[#012131]/95 px-3 py-2 text-xs text-white shadow-lg">
                        <p className="font-semibold text-white">{activeSeriesName}</p>
                        <p className="text-cyan-100/80">{label}</p>
                        <p className="mt-1 font-medium text-white">
                          {formatTooltipValue(activePayload.value)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{
                    color: "rgba(241, 245, 249, 0.9)",
                    fontSize: "12px",
                    paddingTop: "8px",
                  }}
                />
                {SERIES_META.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={activeSeriesName === series.label ? 3.6 : 2.4}
                    strokeOpacity={activeSeriesName && activeSeriesName !== series.label ? 0.28 : 1}
                    dot={{
                      r: activeSeriesName === series.label ? 4.5 : 3.5,
                      fill: series.color,
                      stroke: "#022437",
                      strokeWidth: 1,
                    }}
                    activeDot={{ r: activeSeriesName === series.label ? 6 : 5 }}
                    onMouseEnter={() => setActiveSeriesName(series.label)}
                    onMouseLeave={() => setActiveSeriesName(null)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/30 text-sm text-white/70">
              No trend data available.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
