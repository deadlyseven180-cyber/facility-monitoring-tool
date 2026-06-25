"use client";

import { useEffect, useRef } from "react";
import { Chart, type ChartConfiguration } from "chart.js/auto";

/**
 * Thin Chart.js wrapper. Recreates the chart whenever `config` changes
 * (parents memoize `config` on data + theme), so theme switches re-render it.
 */
export default function ChartCanvas({
  config,
  height = 280,
  ariaLabel,
}: {
  config: ChartConfiguration;
  height?: number;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, config);
    return () => chart.destroy();
  }, [config]);

  return (
    <div style={{ height }} className="relative w-full">
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
