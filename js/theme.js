// Reads a numeric CSS variable from :root (so JS pixel math matches css/tokens.css)
export function cssVar(name, fallback = 0) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
  const num = parseFloat(raw);
  return isNaN(num) ? fallback : num;
}
