const indonesiaDate = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Makassar",
});

export function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? String(value) : indonesiaDate.format(date);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function asNumber(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
