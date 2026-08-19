import type { ComponentStatus, OverallStatus } from "@/lib/extraction";

type ComponentLike = {
  component_name: string;
  measured_value: number | null;
  measured_value_text: string | null;
  reference_min: number | null;
  reference_max: number | null;
  status: string | null;
};

export function classifyComponentStatus(input: {
  measuredValue: number | string | null | undefined;
  referenceMin: number | string | null | undefined;
  referenceMax: number | string | null | undefined;
}): ComponentStatus {
  const toFiniteNumber = (value: number | string | null | undefined): number | null => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const normalized = value.trim().replace(/,/g, "");
      if (!normalized) return null;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  };

  const measuredValue = toFiniteNumber(input.measuredValue);
  let referenceMin = toFiniteNumber(input.referenceMin);
  let referenceMax = toFiniteNumber(input.referenceMax);

  if (referenceMin === 0 && referenceMax === 0) {
    referenceMin = null;
    referenceMax = null;
  }

  if (referenceMin != null && referenceMax != null && referenceMin > referenceMax) {
    const temp = referenceMin;
    referenceMin = referenceMax;
    referenceMax = temp;
  }

  if (measuredValue == null || (referenceMin == null && referenceMax == null)) {
    return "unknown";
  }

  if (referenceMin != null && measuredValue < referenceMin) {
    const lowSpan = Math.max(Math.abs(referenceMin) * 0.1, 0.0001);
    return measuredValue < referenceMin - lowSpan ? "red" : "yellow";
  }

  if (referenceMax != null && measuredValue > referenceMax) {
    const highSpan = Math.max(Math.abs(referenceMax) * 0.1, 0.0001);
    return measuredValue > referenceMax + highSpan ? "red" : "yellow";
  }

  return "green";
}

export function computeOverallStatus(statuses: ComponentStatus[]): OverallStatus {
  if (statuses.includes("red")) return "critical";
  if (statuses.includes("yellow")) return "attention";
  if (statuses.includes("green")) return "stable";
  return "unknown";
}

export function generateObservationBullets(components: ComponentLike[]): string[] {
  if (!components.length) {
    return ["No extracted components are available yet."];
  }

  const attentionNeeded = components.filter((item) => item.status === "red" || item.status === "yellow");
  const inRange = components.filter((item) => item.status === "green").length;

  const bullets: string[] = [];

  if (!attentionNeeded.length) {
    bullets.push("Overall results appear stable based on currently available values.");
  } else {
    bullets.push(
      `Overall results show ${attentionNeeded.length} component(s) that may need follow-up.`,
    );
  }

  if (inRange > 0) {
    bullets.push(`${inRange} component(s) are currently within expected reference range.`);
  }

  attentionNeeded
    .slice(0, 3)
    .forEach((item) => bullets.push(`${item.component_name} appears outside the preferred range and may need review.`));

  bullets.push("Informational support only: confirm with a healthcare professional when needed.");

  return bullets.slice(0, 5);
}
