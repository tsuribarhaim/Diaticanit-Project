export function getEnvironmentBadgeLabel(): string | null {
  const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL?.trim();
  const version = process.env.NEXT_PUBLIC_APP_VERSION?.trim();

  if (!envLabel && !version) {
    return null;
  }

  if (envLabel && version) {
    return `${envLabel} ${version}`;
  }

  return envLabel ?? version ?? null;
}
