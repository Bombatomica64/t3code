import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";

export interface IssueProjectOption {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

/**
 * The projects the Issues page can pick between: those on an environment that serves issues, one
 * per repository, since a repository's worktrees are separate projects with the same issues.
 */
export function issueProjectOptions(
  projects: ReadonlyArray<EnvironmentProject>,
  supportedEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyArray<IssueProjectOption> {
  const seen = new Set<string>();
  const options: IssueProjectOption[] = [];
  for (const project of projects) {
    if (!supportedEnvironmentIds.has(project.environmentId)) continue;
    const repository = project.repositoryIdentity?.canonicalKey.toLowerCase() ?? project.id;
    const key = `${project.environmentId}\u0000${repository}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
    });
  }
  return options.toSorted((left, right) => left.title.localeCompare(right.title));
}

/** The project the URL names, else the first one, so the page always shows something. */
export function resolveIssueProject(
  options: ReadonlyArray<IssueProjectOption>,
  selected: {
    readonly environmentId?: string | undefined;
    readonly projectId?: string | undefined;
  },
): IssueProjectOption | null {
  return (
    options.find(
      (option) =>
        option.projectId === selected.projectId &&
        (selected.environmentId === undefined || option.environmentId === selected.environmentId),
    ) ??
    options[0] ??
    null
  );
}
