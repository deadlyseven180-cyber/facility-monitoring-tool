const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Format a number as USD, e.g. 1234.5 → "$1,234.50". */
export function formatCurrency(value: number): string {
  return currency.format(value);
}

/** Format a score with one decimal place. */
export function formatScore(value: number): string {
  return value.toFixed(1);
}
