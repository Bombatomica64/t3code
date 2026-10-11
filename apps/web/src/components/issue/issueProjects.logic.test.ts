import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { issueProjectOptions, resolveIssueProject } from "./issueProjects.logic";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

function project(
  id: string,
  title: string,
  environmentId: EnvironmentId,
  canonicalKey?: string,
): EnvironmentProject {
  return {
    id: id as ProjectId,
    title,
    environmentId,
    workspaceRoot: `/work/${id}`,
    ...(canonicalKey
      ? {
          repositoryIdentity: {
            canonicalKey,
            locator: { source: "git-remote", remoteName: "origin", remoteUrl: canonicalKey },
          },
        }
      : {}),
  } as unknown as EnvironmentProject;
}

describe("issueProjectOptions", () => {
  it("offers one project per repository per environment, by title", () => {
    const options = issueProjectOptions(
      [
        project("web", "web", local, "github.com/acme/web"),
        project("web-worktree", "web (fix)", local, "github.com/Acme/Web"),
        project("web-remote", "web", remote, "github.com/acme/web"),
        project("api", "api", local, "github.com/acme/api"),
        project("scratch", "scratch", local),
      ],
      new Set([local, remote]),
    );
    expect(options.map((option) => option.projectId)).toEqual([
      "api",
      "scratch",
      "web",
      "web-remote",
    ]);
  });

  it("leaves out environments that cannot serve issues", () => {
    const options = issueProjectOptions(
      [project("web", "web", local, "github.com/acme/web"), project("api", "api", remote)],
      new Set([local]),
    );
    expect(options.map((option) => option.projectId)).toEqual(["web"]);
  });
});

describe("resolveIssueProject", () => {
  const options = issueProjectOptions(
    [project("a", "a", local), project("b", "b", remote)],
    new Set([local, remote]),
  );

  it("picks the project the URL names, on its environment", () => {
    expect(resolveIssueProject(options, { projectId: "b", environmentId: remote })?.projectId).toBe(
      "b",
    );
  });

  it("falls back to the first project for a stale or missing selection", () => {
    expect(resolveIssueProject(options, { projectId: "b", environmentId: local })?.projectId).toBe(
      "a",
    );
    expect(resolveIssueProject(options, {})?.projectId).toBe("a");
    expect(resolveIssueProject([], {})).toBeNull();
  });
});
