import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import {
  findProjectForIssue,
  parseGitHubIssueUrl,
  parseIssueUrl,
  parseLinearIssueUrl,
} from "./openIssueLink";

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

describe("parseLinearIssueUrl", () => {
  it("reads the identifier of an issue link, slug or not", () => {
    expect(parseLinearIssueUrl("https://linear.app/acme/issue/ENG-123/fix-the-login")).toEqual({
      tracker: "linear",
      repositoryKey: null,
      issueId: "ENG-123",
      reference: "ENG-123",
    });
    expect(parseLinearIssueUrl("https://linear.app/acme/issue/eng-7")?.issueId).toBe("ENG-7");
  });

  it("leaves other Linear pages and lookalike hosts alone", () => {
    expect(parseLinearIssueUrl("https://linear.app/acme/project/roadmap-1")).toBeNull();
    expect(parseLinearIssueUrl("https://linear.app.evil.test/acme/issue/ENG-1")).toBeNull();
    expect(parseLinearIssueUrl("http://linear.app/acme/issue/ENG-1")).toBeNull();
  });

  it("is tried after GitHub by the combined parser", () => {
    expect(parseIssueUrl("https://linear.app/acme/issue/ENG-1")?.tracker).toBe("linear");
    expect(parseIssueUrl("https://github.com/acme/web/issues/1")?.tracker).toBe("github");
    // A Linear link names no repository, so no project matches it by remote.
    expect(
      findProjectForIssue(
        [{ id: "web", repositoryIdentity: { canonicalKey: "linear.app/acme" } } as never],
        parseIssueUrl("https://linear.app/acme/issue/ENG-1")!,
      ),
    ).toBeUndefined();
  });
});
