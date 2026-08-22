/** Pure presentation helpers for the market prices page. */

const PAD = 2;

/**
 * SVG polyline points for a sparkline. Rows must be date-ascending;
 * returns "" when there is nothing to draw a line through.
 */
export function sparklinePoints(
  rows: { price_date: string; median_price: number }[],
  width: number,
  height: number,
): string {
  if (rows.length < 2) return "";
  const prices = rows.map((r) => r.median_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  const usable = height - PAD * 2;
  return rows
    .map((r, i) => {
      const x = (i / (rows.length - 1)) * width;
      const y = span === 0 ? height / 2 : PAD + (1 - (r.median_price - min) / span) * usable;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

export function priceDelta(current: number, suggested: number): { amount: number; pct: number } {
  const amount = round2(suggested - current);
  const pct = current === 0 ? 0 : round2((amount / current) * 100);
  return { amount, pct };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
