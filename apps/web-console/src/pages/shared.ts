export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function formatDate(input: string | undefined): string {
  if (!input) {
    return "-";
  }
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) {
    return input;
  }
  return value.toLocaleString();
}

export function parseOptionalNumber(value: string): number | undefined {
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseNullableNumber(value: string): number | null | undefined {
  const text = value.trim();
  if (text.length === 0) {
    return undefined;
  }
  if (text.toLowerCase() === "null") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
