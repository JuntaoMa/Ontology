/**
 * Local no-op telemetry facade.
 *
 * The console can be deployed alongside sensitive ontology and tool data, so
 * the vendored upstream telemetry integration is intentionally disabled. Keep
 * this tiny compatibility surface for upstream merges without importing an
 * analytics SDK or sending data off-device.
 */
export async function initTelemetry(_enabled = false): Promise<void> {}

export function trackEvent(
  _name: string,
  _properties?: Record<string, string>,
): void {}

export function trackError(
  _error: Error,
  _properties?: Record<string, string>,
): void {}

export function trackMetric(
  _name: string,
  _value: number,
  _properties?: Record<string, string>,
): void {}

export function setTelemetryEnabled(_enabled: boolean): void {}

export function isTelemetryEnabled(): boolean {
  return false;
}
