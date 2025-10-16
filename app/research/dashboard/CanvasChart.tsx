"use client";

import React, { useEffect, useRef } from "react";

type ChartPoint = { value: number; dateLabel: string; opponent?: string; fullDate?: string };

type Props = {
  data: ChartPoint[];
  propLine: number;
  unitLabel: string;
  themeDark: boolean;
  height: number;
  leftMargin: number;
  rightMargin: number;
  timeFilter: string;
  yHeadroom?: number;
  marginTop?: number;
  marginBottom?: number;
};

export default function CanvasChart({
  data,
  propLine,
  unitLabel,
  themeDark,
  height,
  leftMargin,
  rightMargin,
  timeFilter: _timeFilter,
  yHeadroom = 0.15,
  marginTop = 40,
  marginBottom = 40,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Redraw chart on data/size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const widthCss = container.clientWidth || 800;
    const heightCss = Math.max(120, height);

    canvas.style.width = `${widthCss}px`;
    canvas.style.height = `${heightCss}px`;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = themeDark ? "#0f172a" : "#ffffff";
    const text = themeDark ? "#e2e8f0" : "#0f172a";
    const grid = themeDark ? "#1f2937" : "#e5e7eb";
    const accent = themeDark ? "#34d399" : "#2563eb";
    const lineColor = themeDark ? "#f59e0b" : "#ef4444";

    // Clear
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, widthCss, heightCss);

    // Plot area
    const plotL = Math.max(24, leftMargin);
    const plotR = Math.max(16, rightMargin);
    const plotT = Math.max(24, marginTop);
    const plotB = Math.max(24, marginBottom);
    const plotW = Math.max(10, widthCss - plotL - plotR);
    const plotH = Math.max(10, heightCss - plotT - plotB);

    // Axis
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotL, plotT);
    ctx.lineTo(plotL, plotT + plotH);
    ctx.lineTo(plotL + plotW, plotT + plotH);
    ctx.stroke();

    // Data domain
    const values = data.map(d => (typeof d.value === "number" && isFinite(d.value) ? d.value : 0));
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 1;
    const span = Math.max(1e-6, maxVal - minVal);
    const yMax = maxVal + span * (yHeadroom ?? 0.15);
    const yMin = Math.min(minVal, propLine, 0);

    const xAt = (i: number) => {
      if (data.length <= 1) return plotL + plotW / 2;
      return plotL + (i / (data.length - 1)) * plotW;
    };
    const yAt = (v: number) => {
      const t = (v - yMin) / Math.max(1e-6, yMax - yMin);
      return plotT + (1 - Math.max(0, Math.min(1, t))) * plotH;
    };

    // Gridlines (5)
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const yy = plotT + (i / 5) * plotH;
      ctx.beginPath();
      ctx.moveTo(plotL, yy);
      ctx.lineTo(plotL + plotW, yy);
      ctx.stroke();
    }

    // Series line
    if (data.length > 0) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(values[0] ?? 0));
      for (let i = 1; i < data.length; i++) {
        ctx.lineTo(xAt(i), yAt(values[i] ?? 0));
      }
      ctx.stroke();

      // Points
      ctx.fillStyle = accent;
      for (let i = 0; i < data.length; i++) {
        const x = xAt(i);
        const y = yAt(values[i] ?? 0);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Prop line
    if (Number.isFinite(propLine)) {
      const y = yAt(propLine);
      ctx.strokeStyle = lineColor;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotL + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = lineColor;
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      const label = `${unitLabel || ''} ${propLine}`.trim();
      ctx.fillText(label, plotL + 6, Math.max(plotT + 12, Math.min(y - 4, plotT + plotH - 4)));
    }

    // Y-axis labels (min/mid/max)
    ctx.fillStyle = text;
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    const yLbls = [yMin, yMin + (yMax - yMin) / 2, yMax];
    yLbls.forEach((v, i) => {
      const yy = yAt(v);
      const txt = (Math.round(v * 10) / 10).toString();
      ctx.fillText(txt, 4, Math.max(12, Math.min(yy, heightCss - 4)));
    });

    // X-axis labels (start, mid, end)
    if (data.length > 0) {
      const idxs = [0, Math.floor((data.length - 1) / 2), data.length - 1];
      const labels = Array.from(new Set(idxs)).map(i => ({ i, label: data[i]?.dateLabel || String(i + 1) }));
      labels.forEach(({ i, label }) => {
        const x = xAt(i);
        const y = plotT + plotH + 16;
        ctx.fillText(label, Math.max(plotL, Math.min(x - ctx.measureText(label).width / 2, plotL + plotW - 24)), y);
      });
    }
  }, [data, propLine, unitLabel, themeDark, height, leftMargin, rightMargin, yHeadroom, marginTop, marginBottom]);

  return (
    <div ref={containerRef} style={{ width: "100%", height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
