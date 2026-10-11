import type { ProjectSettingsOverrides } from "@t3tools/contracts";

/**
 * A project's override entry with one tracker source setting changed, as the settings patch stores
 * it: the whole entry. `null` removes the project's choice so it inherits the environment's, and an
 * entry left with nothing in it is removed outright.
 */
export function issueSourceOverrideEntry(
  current: ProjectSettingsOverrides | undefined,
  key: "linearTeamId",
  value: string | null,
): ProjectSettingsOverrides | null {
  const { [key]: _previous, ...rest } = current ?? {};
  const entry = value === null ? rest : { ...rest, [key]: value };
  return Object.keys(entry).length === 0 ? null : entry;
}
