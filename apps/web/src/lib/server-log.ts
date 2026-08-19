type ErrorMeta = Record<string, unknown>;

export function logServerError(
  scope: string,
  message: string,
  meta: ErrorMeta = {},
) {
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      message,
      meta,
      timestamp: new Date().toISOString(),
    }),
  );
}
