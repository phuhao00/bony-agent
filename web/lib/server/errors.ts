export function errorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

export function abortCauseMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? message : undefined;
  }
  return undefined;
}
