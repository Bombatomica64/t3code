import { assert, describe, it } from "@effect/vitest";
import type { ProjectId } from "@t3tools/contracts";
import * as GitHubApi from "@t3tools/source-control-github/server/GitHubApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import {
  decodeIssueDetailJson,
  decodeIssueSearchJson,
  issueSearchQuery,
  make,
} from "./GitHubIssueProvider.ts";
import type { IssueProject } from "./IssueProvider.ts";

const gitHubProject = (provider = "github"): IssueProject => ({
  id: "project-1" as ProjectId,
  workspaceRoot: "/repo",
  repositoryIdentity: {
    canonicalKey: "github.com/acme/web",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/web",
    },
    provider,
    displayName: "acme/web",
  },
});

const issueNode = (number: number, overrides: Record<string, unknown> = {}) => ({
  __typename: "Issue",
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/web/issues/${number}`,
  state: "OPEN",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  author: { __typename: "User", login: "octo", name: "Octo Cat", avatarUrl: "https://a/octo" },
  labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
  assignees: { nodes: [{ __typename: "Bot", login: "helper[bot]", avatarUrl: null }] },
  comments: { totalCount: 3 },
  ...overrides,
});

const provideApi = (graphql: GitHubApi.GitHubApi["Service"]["graphql"]) =>
  Effect.provide(Layer.mock(GitHubApi.GitHubApi)({ graphql }));

describe("issueSearchQuery", () => {
  it("scopes the search to the repository's issues and maps every filter", () => {
    assert.strictEqual(
      issueSearchQuery({
        repository: "acme/web",
        state: "open",
        assignee: "me",
        label: "good first issue",
        query: "login crash",
      }),
      'repo:acme/web is:issue is:open assignee:@me label:"good first issue" "login" "crash" sort:updated-desc',
    );
    assert.strictEqual(
      issueSearchQuery({
        repository: "acme/web",
        state: "all",
        assignee: "none",
        label: undefined,
        query: undefined,
      }),
      "repo:acme/web is:issue no:assignee sort:updated-desc",
    );
  });

  it("keeps typed qualifiers from reading beyond the project", () => {
    const query = issueSearchQuery({
      repository: "acme/web",
      state: "open",
      assignee: "anyone",
      label: 'x" repo:other/secret',
      query: 'repo:other/secret is:pr "quoted',
    });
    assert.include(query, '"repo:other/secret" "is:pr" "quoted"');
    assert.include(query, 'label:"x repo:other/secret"');
    // Outside the quoted terms, the project's own repository is the only one named.
    assert.deepStrictEqual(query.replace(/"[^"]*"/g, '""').match(/repo:\S+/g), ["repo:acme/web"]);
  });
});

describe("decodeIssueSearchJson", () => {
  it("reads issues, skips anything else the search returned, and carries the cursor", () => {
    const decoded = decodeIssueSearchJson(
      JSON.stringify({
        data: {
          search: {
            pageInfo: { hasNextPage: true, endCursor: "Y3Vyc29yOjUw" },
            nodes: [issueNode(7), {}, null],
          },
        },
      }),
    );
    assert.isTrue(Result.isSuccess(decoded));
    if (!Result.isSuccess(decoded)) return;
    assert.strictEqual(decoded.success.nextCursor, "Y3Vyc29yOjUw");
    assert.deepStrictEqual(decoded.success.items, [
      {
        id: "7",
        reference: "#7",
        title: "Issue 7",
        url: "https://github.com/acme/web/issues/7",
        state: "open",
        author: { login: "octo", name: "Octo Cat", avatarUrl: "https://a/octo" },
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: [{ login: "helper[bot]", name: null, avatarUrl: null, isBot: true }],
        commentCount: 3,
        createdAt: "2026-10-01T10:00:00Z",
        updatedAt: "2026-10-02T10:00:00Z",
      },
    ]);
  });

  it("has no next cursor on the last page", () => {
    const decoded = decodeIssueSearchJson(
      JSON.stringify({
        data: { search: { pageInfo: { hasNextPage: false, endCursor: "end" }, nodes: [] } },
      }),
    );
    assert.deepStrictEqual(Result.getOrThrow(decoded), { items: [], nextCursor: null });
  });
});

describe("decodeIssueDetailJson", () => {
  it("reads the body, close reason and comments", () => {
    const decoded = decodeIssueDetailJson(
      JSON.stringify({
        data: {
          repository: {
            issue: {
              ...issueNode(9, { state: "CLOSED" }),
              body: "Steps to reproduce",
              closedAt: "2026-10-03T10:00:00Z",
              stateReason: "NOT_PLANNED",
              comments: {
                totalCount: 120,
                nodes: [
                  {
                    id: "IC_1",
                    url: "https://github.com/acme/web/issues/9#issuecomment-1",
                    body: "Same here",
                    createdAt: "2026-10-02T11:00:00Z",
                    author: null,
                  },
                ],
              },
            },
          },
        },
      }),
    );
    const issue = Result.getOrThrow(decoded);
    assert.strictEqual(issue?.state, "closed");
    assert.strictEqual(issue?.stateReason, "not-planned");
    assert.strictEqual(issue?.commentCount, 120);
    assert.deepStrictEqual(issue?.comments, [
      {
        id: "IC_1",
        author: null,
        body: "Same here",
        createdAt: "2026-10-02T11:00:00Z",
        url: "https://github.com/acme/web/issues/9#issuecomment-1",
      },
    ]);
  });

  it("is null when GitHub has no such issue", () => {
    const decoded = decodeIssueDetailJson(
      JSON.stringify({ data: { repository: { issue: null } } }),
    );
    assert.isNull(Result.getOrThrow(decoded));
  });
});

describe("GitHubIssueProvider", () => {
  it.effect("lists through one search against the project's host", () =>
    Effect.gen(function* () {
      const requests: Array<GitHubApi.GitHubGraphQlInput> = [];
      const provider = yield* make.pipe(
        provideApi((input) => {
          requests.push(input);
          return Effect.succeed(
            JSON.stringify({
              data: { search: { pageInfo: { hasNextPage: false }, nodes: [issueNode(1)] } },
            }),
          );
        }),
      );
      const page = yield* provider.listIssues(gitHubProject(), {
        state: "closed",
        assignee: "anyone",
        label: undefined,
        query: undefined,
        limit: 500,
        cursor: "abc",
      });
      assert.deepStrictEqual(
        page.items.map((item) => item.id),
        ["1"],
      );
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0]?.host, "github.com");
      assert.deepStrictEqual(requests[0]?.variables, {
        q: "repo:acme/web is:issue is:closed sort:updated-desc",
        first: 100,
        after: "abc",
      });
    }),
  );

  it.effect("refuses a project that is not on GitHub without asking GitHub", () =>
    Effect.gen(function* () {
      const provider = yield* make.pipe(provideApi(() => Effect.die("unexpected request")));
      const error = yield* Effect.flip(provider.sourceName(gitHubProject("gitlab")));
      assert.strictEqual(error.reason, "unsupported");
    }),
  );

  it.effect("reports a rate limit as such, and an unknown issue as not found", () =>
    Effect.gen(function* () {
      const limited = yield* make.pipe(
        provideApi((input) =>
          Effect.fail(
            new GitHubApi.GitHubApiRateLimitError({ host: input.host, operation: input.operation }),
          ),
        ),
      );
      const rateLimited = yield* Effect.flip(limited.getIssue(gitHubProject(), "4"));
      assert.strictEqual(rateLimited.reason, "rate-limited");

      const missing = yield* make.pipe(
        provideApi(() => Effect.succeed(JSON.stringify({ data: { repository: { issue: null } } }))),
      );
      assert.strictEqual(
        (yield* Effect.flip(missing.getIssue(gitHubProject(), "4"))).reason,
        "not-found",
      );
      assert.strictEqual(
        (yield* Effect.flip(missing.getIssue(gitHubProject(), "ENG-4"))).reason,
        "not-found",
      );
    }),
  );
});
