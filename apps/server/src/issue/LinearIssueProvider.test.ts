import { assert, describe, it } from "@effect/vitest";
import type { ProjectId, ServerSettings } from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSettingsService from "../serverSettings.ts";
import type { IssueProject } from "./IssueProvider.ts";
import { linearFailureReason, linearIssueFilter, make } from "./LinearIssueProvider.ts";

// Fixture values only: no real key or workspace is ever contacted.
const API_KEY = "fixture-not-a-real-key";
const TEAM_ID = "team-eng";

const project: IssueProject = {
  id: "project-1" as ProjectId,
  workspaceRoot: "/repo",
  repositoryIdentity: null,
};

const linearIssue = (identifier: string, overrides: Record<string, unknown> = {}) => ({
  id: `uuid-${identifier}`,
  identifier,
  title: `Fix ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  completedAt: null,
  canceledAt: null,
  state: { name: "In Progress", type: "started" },
  creator: { name: "Ada Lovelace", displayName: "ada", avatarUrl: "https://a/ada" },
  assignee: null,
  labels: { nodes: [{ name: "Bug", color: "#eb5757" }] },
  ...overrides,
});

interface Recorded {
  readonly authorization: string | undefined;
  readonly body: { readonly query: string; readonly variables: Record<string, unknown> };
}

function harness(input: {
  readonly settings?: Partial<ServerSettings>;
  readonly respond: (body: Recorded["body"]) => { status?: number; json: unknown };
}) {
  const requests: Recorded[] = [];
  const httpClient = HttpClient.make((request) => {
    const body = JSON.parse(
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}",
    ) as Recorded["body"];
    requests.push({ authorization: request.headers.authorization, body });
    const answer = input.respond(body);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(answer.json), { status: answer.status ?? 200 }),
      ),
    );
  });
  const provider = make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, httpClient),
        Layer.mock(ServerSettingsService.ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            linearApiKey: API_KEY,
            linearTeamId: TEAM_ID,
            ...input.settings,
          }),
        }),
      ),
    ),
  );
  return { provider, requests };
}

describe("linearIssueFilter", () => {
  it("narrows to the team and maps every filter onto Linear's own", () => {
    assert.deepStrictEqual(
      linearIssueFilter({
        teamId: TEAM_ID,
        state: "open",
        assignee: "me",
        label: "Bug",
        query: " crash ",
      }),
      {
        team: { id: { eq: TEAM_ID } },
        state: { type: { nin: ["completed", "canceled", "duplicate"] } },
        assignee: { isMe: { eq: true } },
        labels: { some: { name: { eqIgnoreCase: "Bug" } } },
        or: [
          { title: { containsIgnoreCase: "crash" } },
          { description: { containsIgnoreCase: "crash" } },
        ],
      },
    );
    assert.deepStrictEqual(
      linearIssueFilter({
        teamId: TEAM_ID,
        state: "all",
        assignee: "none",
        label: undefined,
        query: undefined,
      }),
      { team: { id: { eq: TEAM_ID } }, assignee: { null: true } },
    );
  });
});

describe("linearFailureReason", () => {
  it("reads authentication and rate limits from status or Linear's codes", () => {
    assert.strictEqual(linearFailureReason(400, ["AUTHENTICATION_ERROR"]), "unauthenticated");
    assert.strictEqual(linearFailureReason(401, []), "unauthenticated");
    assert.strictEqual(linearFailureReason(400, ["RATELIMITED"]), "rate-limited");
    assert.strictEqual(linearFailureReason(200, ["INVALID_INPUT"]), "failed");
  });
});

describe("LinearIssueProvider", () => {
  it.effect("lists a page of the project's team with the key as the whole header", () =>
    Effect.gen(function* () {
      const { provider, requests } = harness({
        respond: () => ({
          json: {
            data: {
              issues: {
                pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
                nodes: [
                  linearIssue("ENG-12", {
                    assignee: { name: "Grace Hopper", displayName: "grace", avatarUrl: null },
                  }),
                  linearIssue("ENG-11", {
                    state: { name: "Done", type: "completed" },
                    completedAt: "2026-10-02T00:00:00.000Z",
                  }),
                ],
              },
            },
          },
        }),
      });
      const linear = yield* provider;
      const page = yield* linear.listIssues(project, {
        state: "all",
        assignee: "anyone",
        label: undefined,
        query: undefined,
        limit: 50,
        cursor: "cursor-1",
      });
      assert.strictEqual(requests[0]?.authorization, API_KEY);
      assert.deepStrictEqual(requests[0]?.body.variables, {
        filter: { team: { id: { eq: TEAM_ID } } },
        first: 50,
        after: "cursor-1",
      });
      assert.strictEqual(page.nextCursor, "cursor-2");
      assert.deepStrictEqual(page.items[0], {
        id: "ENG-12",
        reference: "ENG-12",
        title: "Fix ENG-12",
        url: "https://linear.app/acme/issue/ENG-12",
        state: "open",
        statusName: "In Progress",
        author: { login: "ada", name: "Ada Lovelace", avatarUrl: "https://a/ada" },
        labels: [{ name: "Bug", color: "#eb5757" }],
        assignees: [{ login: "grace", name: "Grace Hopper", avatarUrl: null }],
        commentCount: null,
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-02T10:00:00.000Z",
      });
      assert.strictEqual(page.items[1]?.state, "closed");
    }),
  );

  it.effect("reads an issue of the team with its comments in order", () =>
    Effect.gen(function* () {
      const { provider } = harness({
        respond: () => ({
          json: {
            data: {
              issue: {
                ...linearIssue("ENG-7", {
                  state: { name: "Canceled", type: "canceled" },
                  canceledAt: "2026-10-03T00:00:00.000Z",
                }),
                description: "It breaks.",
                team: { id: TEAM_ID },
                comments: {
                  pageInfo: { hasNextPage: true },
                  nodes: [
                    { id: "c2", body: "Later", createdAt: "2026-10-02T12:00:00.000Z", user: null },
                    {
                      id: "c1",
                      body: "First",
                      createdAt: "2026-10-02T11:00:00.000Z",
                      url: "https://linear.app/acme/issue/ENG-7#comment-c1",
                      user: { name: "Ada Lovelace", displayName: "ada" },
                    },
                  ],
                },
              },
            },
          },
        }),
      });
      const issue = yield* (yield* provider).getIssue(project, "ENG-7");
      assert.strictEqual(issue.body, "It breaks.");
      assert.strictEqual(issue.state, "closed");
      assert.strictEqual(issue.stateReason, "not-planned");
      assert.strictEqual(issue.closedAt, "2026-10-03T00:00:00.000Z");
      assert.deepStrictEqual(
        issue.comments.map((comment) => [comment.id, comment.author?.login ?? null]),
        [
          ["c1", "ada"],
          ["c2", null],
        ],
      );
      assert.isTrue(issue.moreComments);
    }),
  );

  it.effect("refuses an issue from another team", () =>
    Effect.gen(function* () {
      const { provider } = harness({
        respond: () => ({
          json: {
            data: {
              issue: {
                ...linearIssue("OPS-1"),
                team: { id: "team-ops" },
                comments: { pageInfo: { hasNextPage: false }, nodes: [] },
              },
            },
          },
        }),
      });
      const error = yield* Effect.flip((yield* provider).getIssue(project, "OPS-1"));
      assert.strictEqual(error.reason, "not-found");
    }),
  );

  it.effect("is unsupported without a key and asks for a team without one", () =>
    Effect.gen(function* () {
      const noKey = harness({
        settings: { linearApiKey: "" },
        respond: () => ({ json: {} }),
      });
      const unsupported = yield* Effect.flip((yield* noKey.provider).sourceName(project));
      assert.strictEqual(unsupported.reason, "unsupported");
      assert.strictEqual(noKey.requests.length, 0);

      const noTeam = harness({
        settings: { linearTeamId: "" },
        respond: () => ({
          json: {
            data: {
              teams: {
                nodes: [
                  { id: "t2", key: "OPS", name: "Operations" },
                  { id: "t1", key: "ENG", name: "Engineering" },
                ],
              },
            },
          },
        }),
      });
      const linear = yield* noTeam.provider;
      const notConfigured = yield* Effect.flip(linear.sourceName(project));
      assert.strictEqual(notConfigured.reason, "not-configured");
      // The picker can still list the teams, which only needs the key.
      assert.deepStrictEqual(yield* linear.sourceOptions(project), [
        { id: "t1", name: "Engineering (ENG)" },
        { id: "t2", name: "Operations (OPS)" },
      ]);
    }),
  );

  it.effect("names the team, and reports a refused key without echoing it", () =>
    Effect.gen(function* () {
      const named = harness({
        respond: () => ({
          json: { data: { team: { id: TEAM_ID, key: "ENG", name: "Engineering" } } },
        }),
      });
      assert.strictEqual(yield* (yield* named.provider).sourceName(project), "Engineering");

      const refused = harness({
        respond: () => ({
          status: 400,
          json: {
            errors: [
              { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
            ],
          },
        }),
      });
      const error = yield* Effect.flip((yield* refused.provider).sourceName(project));
      assert.strictEqual(error.reason, "unauthenticated");
      assert.notInclude(error.detail, API_KEY);
    }),
  );
});
