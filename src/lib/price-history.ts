/** A single recorded date is enough for a dated point; no fabricated trend. */
export function hasPriceHistoryPoints(history: { points: number; series: Array<{ date: string; price: number }> }): boolean {
  return history.points > 0 && history.series.some((point) =>
    Number.isFinite(Date.parse(point.date)) && Number.isFinite(point.price) && point.price > 0,
  );
}
