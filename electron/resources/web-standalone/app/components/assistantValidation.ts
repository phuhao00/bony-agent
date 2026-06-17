export function requireTrimmed(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

export function rejectPlaceholders(
  value: string,
  placeholders: string[],
  message: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || placeholders.some((p) => trimmed === p)) {
    return message;
  }
  return null;
}
