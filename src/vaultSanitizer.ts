// Older clients stored user-provided provider keys in encrypted settings.
// Keep every other setting when removing these retired credential fields.
export function stripLegacyAIKeys<T extends { settings: object }>(vault: T): T {
  const settings = { ...vault.settings } as Record<string, unknown>;
  delete settings.aiApiKey;
  delete settings.groqApiKey;
  return { ...vault, settings };
}
