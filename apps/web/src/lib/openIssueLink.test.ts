import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import { findProjectForIssue, parseGitHubIssueUrl } from "./openIssueLink";

describe("parseGitHubIssueUrl", () => {
  it("reads the repository and number of an issue link", () => {
    expect(parseGitHubIssueUrl("https://github.com/PingDotGG/T3Code/issues/42")).toEqual({
      tracker: "github",
      repositoryKey: "github.com/pingdotgg/t3code",
      issueId: "42",
      reference: "#42",
    });
    expect(
      parseGitHubIssueUrl("https://ghe.acme.test/team/web/issues/7#issuecomment-1")?.repositoryKey,
    ).toBe("ghe.acme.test/team/web");
  });

  it("leaves pull requests and other pages to other handlers", () => {
    expect(parseGitHubIssueUrl("https://github.com/acme/web/pull/42")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/acme/web/issues")).toBeNull();
    expect(parseGitHubIssueUrl("https://github.com/acme/web/issues/42/files")).toBeNull();
    expect(parseGitHubIssueUrl("not a url")).toBeNull();
    expect(parseGitHubIssueUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("findProjectForIssue", () => {
  const project = (id: string, canonicalKey?: string) =>
    ({
      id,
      ...(canonicalKey ? { repositoryIdentity: { canonicalKey } } : {}),
    }) as unknown as EnvironmentProject;

  it("matches the project checking out the issue's repository", () => {
    const link = parseGitHubIssueUrl("https://github.com/acme/web/issues/1")!;
    expect(
      findProjectForIssue(
        [
          project("api", "github.com/acme/api"),
          project("web", "github.com/Acme/Web"),
          project("x"),
        ],
        link,
      )?.id,
    ).toBe("web");
    expect(findProjectForIssue([project("api", "github.com/acme/api")], link)).toBeUndefined();
  });
});
