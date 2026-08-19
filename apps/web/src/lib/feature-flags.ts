export function isPhase2Enabled(): boolean {
  const value = process.env.FEATURE_PHASE2;

  // Default to enabled for internal development unless explicitly disabled.
  return value !== "false";
}

export function isPhase2DemoEnabled(): boolean {
  const value = process.env.FEATURE_PHASE2_DEMO;

  // Demo actions remain hidden unless explicitly turned on.
  return value === "true";
}
