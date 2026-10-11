/**
 * Linear issues through Linear's GraphQL API, authenticated with the personal API key saved in
 * Settings → Integrations. A project's issues are one Linear team's, chosen per project through
 * the `linearTeamId` setting; without a key the tracker is not offered at all.
 */
import type {
  IssueAssigneeFilter,
  IssueComment,
  IssueDetail,
  IssueListEntry,
  IssueListState,
  IssueStateReason,
  PullRequestActor,
  PullRequestLabel,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { IssueProviderError, type IssueProject, type IssueProviderApi } from "./IssueProvider.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const TIMEOUT = Duration.seconds(30);
/** Linear's page size ceiling for a connection. */
const MAX_PAGE_SIZE = 100;
const DETAIL_COMMENT_LIMIT = 100;
/** The workflow state types Linear counts as done with. */
const CLOSED_STATE_TYPES = ["completed", "canceled", "duplicate"];
const CLOSED_STATE_TYPE_SET = new Set(CLOSED_STATE_TYPES);

const ACTOR_FIELDS = "name displayName avatarUrl";
const ISSUE_FIELDS = `
  id identifier title url createdAt updatedAt completedAt canceledAt
  state { name type }
  creator { ${ACTOR_FIELDS} }
  assignee { ${ACTOR_FIELDS} }
  labels(first: 20) { nodes { name color } }`;

const LIST_QUERY = `
query LinearIssues($filter: IssueFilter!, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ISSUE_FIELDS} }
  }
}`;

const DETAIL_QUERY = `
query LinearIssue($id: String!) {
  issue(id: $id) {
    ${ISSUE_FIELDS}
    description
    team { id }
    comments(first: ${DETAIL_COMMENT_LIMIT}) {
      pageInfo { hasNextPage }
      nodes { id body createdAt url user { ${ACTOR_FIELDS} } }
    }
  }
}`;

const TEAM_QUERY = `query LinearTeam($id: String!) { team(id: $id) { id key name } }`;
const TEAMS_QUERY = `query LinearTeams { teams(first: 100) { nodes { id key name } } }`;

const RawActor = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  canceledAt: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String })),
  ),
  creator: Schema.optional(Schema.NullOr(RawActor)),
  assignee: Schema.optional(Schema.NullOr(RawActor)),
  labels: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            color: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    ),
  ),
});

const RawTeam = Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String });

const RawError = Schema.Struct({
  message: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
});

/** Every Linear answer: data where it could, errors where it could not. */
const envelope = <A extends Schema.Top>(data: A) =>
  Schema.Struct({
    data: Schema.optional(Schema.NullOr(data)),
    errors: Schema.optional(Schema.Array(RawError)),
  });

const decodeList = decodeJsonResult(
  envelope(
    Schema.Struct({
      issues: Schema.Struct({
        pageInfo: Schema.Struct({
          hasNextPage: Schema.Boolean,
          endCursor: Schema.optional(Schema.NullOr(Schema.String)),
        }),
        nodes: Schema.Array(RawIssue),
      }),
    }),
  ),
);

const decodeDetail = decodeJsonResult(
  envelope(
    Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          ...RawIssue.fields,
          description: Schema.optional(Schema.NullOr(Schema.String)),
          team: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
          comments: Schema.Struct({
            pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
            nodes: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                body: Schema.String,
                createdAt: Schema.String,
                url: Schema.optional(Schema.NullOr(Schema.String)),
                user: Schema.optional(Schema.NullOr(RawActor)),
              }),
            ),
          }),
        }),
      ),
    }),
  ),
);

const decodeTeam = decodeJsonResult(envelope(Schema.Struct({ team: Schema.NullOr(RawTeam) })));
const decodeTeams = decodeJsonResult(
  envelope(Schema.Struct({ teams: Schema.Struct({ nodes: Schema.Array(RawTeam) }) })),
);

function toActor(raw: typeof RawActor.Type | null | undefined): PullRequestActor | null {
  const login = raw?.displayName?.trim() || raw?.name?.trim();
  if (!login) return null;
  return { login, name: raw?.name?.trim() || null, avatarUrl: raw?.avatarUrl?.trim() || null };
}

function toEntry(raw: typeof RawIssue.Type): IssueListEntry {
  const statusName = raw.state?.name.trim();
  return {
    id: raw.identifier,
    reference: raw.identifier,
    title: raw.title,
    url: raw.url,
    state: CLOSED_STATE_TYPE_SET.has(raw.state?.type ?? "") ? "closed" : "open",
    ...(statusName ? { statusName } : {}),
    author: toActor(raw.creator),
    labels: (raw.labels?.nodes ?? []).flatMap((label): PullRequestLabel[] => {
      const name = label.name.trim();
      return name ? [{ name, color: label.color?.trim() || null }] : [];
    }),
    assignees: raw.assignee ? [toActor(raw.assignee)].flatMap((actor) => actor ?? []) : [],
    // Linear does not count a connection's nodes, and paging every issue's comments to count them
    // would cost more than the row is worth.
    commentCount: null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const STATE_REASONS: Partial<Record<string, IssueStateReason>> = {
  completed: "completed",
  canceled: "not-planned",
  duplicate: "duplicate",
};

/** Linear's `IssueFilter` for one listing of one team. */
export function linearIssueFilter(input: {
  readonly teamId: string;
  readonly state: IssueListState;
  readonly assignee: IssueAssigneeFilter;
  readonly label: string | undefined;
  readonly query: string | undefined;
}): Record<string, unknown> {
  const query = input.query?.trim();
  return {
    team: { id: { eq: input.teamId } },
    ...(input.state === "all"
      ? {}
      : {
          state: {
            type:
              input.state === "closed" ? { in: CLOSED_STATE_TYPES } : { nin: CLOSED_STATE_TYPES },
          },
        }),
    ...(input.assignee === "me" ? { assignee: { isMe: { eq: true } } } : {}),
    ...(input.assignee === "none" ? { assignee: { null: true } } : {}),
    ...(input.label === undefined
      ? {}
      : { labels: { some: { name: { eqIgnoreCase: input.label } } } }),
    ...(query
      ? {
          or: [
            { title: { containsIgnoreCase: query } },
            { description: { containsIgnoreCase: query } },
          ],
        }
      : {}),
  };
}

type LinearReason = IssueProviderError["reason"];

/** What a refused answer means, from its HTTP status and Linear's own error codes. */
export function linearFailureReason(status: number, codes: ReadonlyArray<string>): LinearReason {
  const upper = new Set(codes.map((code) => code.toUpperCase()));
  if (status === 401 || upper.has("AUTHENTICATION_ERROR")) return "unauthenticated";
  if (status === 429 || upper.has("RATELIMITED")) return "rate-limited";
  return "failed";
}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;

  const fail = (operation: string, reason: LinearReason, detail: string, cause?: unknown) =>
    new IssueProviderError({
      tracker: "linear",
      operation,
      reason,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  /** The key and the project's team, read fresh so a saved or cleared setting applies at once. */
  const configuration = (project: IssueProject, operation: string) =>
    settingsService.getSettings.pipe(
      Effect.mapError((cause) => fail(operation, "failed", "Settings could not be read.", cause)),
      Effect.flatMap((settings) => {
        const apiKey = settings.linearApiKey.trim();
        if (apiKey.length === 0) {
          return Effect.fail(
            fail(operation, "unsupported", "Add a Linear API key in Settings → Integrations."),
          );
        }
        const teamId = resolveProjectSettings(settings, project.id).settings.linearTeamId.trim();
        return Effect.succeed({ apiKey, teamId: teamId.length > 0 ? teamId : null });
      }),
    );

  const configuredTeam = (project: IssueProject, operation: string) =>
    configuration(project, operation).pipe(
      Effect.flatMap(({ apiKey, teamId }) =>
        teamId === null
          ? Effect.fail(
              fail(
                operation,
                "not-configured",
                "Choose the Linear team whose issues this project shows.",
              ),
            )
          : Effect.succeed({ apiKey, teamId }),
      ),
    );

  const graphql = <A>(input: {
    readonly apiKey: string;
    readonly operation: string;
    readonly query: string;
    readonly variables?: Readonly<Record<string, unknown>>;
    readonly decode: (raw: string) => Result.Result<
      {
        readonly data?: A | null | undefined;
        readonly errors?: ReadonlyArray<typeof RawError.Type> | undefined;
      },
      unknown
    >;
  }) =>
    Effect.gen(function* () {
      const response = yield* httpClient
        .execute(
          HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
            // Linear takes a personal API key as the whole header, without a scheme.
            HttpClientRequest.setHeader("authorization", input.apiKey),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyJsonUnsafe({
              query: input.query,
              variables: input.variables ?? {},
            }),
          ),
        )
        .pipe(
          // The request's URL and headers stay out of traces: the header is the key itself.
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.flatMap((response) =>
            response.text.pipe(Effect.map((text) => ({ status: response.status, text }))),
          ),
          Effect.timeout(TIMEOUT),
          Effect.mapError((cause) =>
            fail(input.operation, "failed", "Could not reach Linear.", cause),
          ),
        );
      const decoded = input.decode(response.text);
      if (Result.isFailure(decoded)) {
        return yield* fail(
          input.operation,
          response.status >= 400 ? linearFailureReason(response.status, []) : "failed",
          response.status >= 400
            ? `Linear refused the request (HTTP ${response.status}).`
            : "Linear answered in a shape T3 Code cannot read.",
        );
      }
      const { data, errors = [] } = decoded.success;
      if (errors.length > 0 || response.status >= 400 || data == null) {
        const reason = linearFailureReason(
          response.status,
          errors.flatMap((error) => error.extensions?.code ?? []),
        );
        const message = errors.flatMap((error) => error.message?.trim() || []).join("; ");
        return yield* fail(
          input.operation,
          reason,
          reason === "unauthenticated"
            ? "Linear refused the API key. Replace it in Settings → Integrations."
            : reason === "rate-limited"
              ? "Linear's rate limit was reached. Try again in a minute."
              : message || `Linear returned HTTP ${response.status}.`,
        );
      }
      return data;
    });

  return {
    kind: "linear",
    sourceName: (project) =>
      configuredTeam(project, "sourceName").pipe(
        Effect.flatMap(({ apiKey, teamId }) =>
          graphql({
            apiKey,
            operation: "sourceName",
            query: TEAM_QUERY,
            variables: { id: teamId },
            decode: decodeTeam,
          }),
        ),
        Effect.flatMap(({ team }) =>
          team === null
            ? Effect.fail(
                fail("sourceName", "not-found", "The chosen Linear team is gone. Choose another."),
              )
            : Effect.succeed(team.name),
        ),
      ),
    sourceOptions: (project) =>
      configuration(project, "sourceOptions").pipe(
        Effect.flatMap(({ apiKey }) =>
          graphql({ apiKey, operation: "sourceOptions", query: TEAMS_QUERY, decode: decodeTeams }),
        ),
        Effect.map(({ teams }) =>
          teams.nodes
            .map((team) => ({ id: team.id, name: `${team.name} (${team.key})` }))
            .toSorted((left, right) => left.name.localeCompare(right.name)),
        ),
      ),
    listIssues: (project, input) =>
      configuredTeam(project, "listIssues").pipe(
        Effect.flatMap(({ apiKey, teamId }) =>
          graphql({
            apiKey,
            operation: "listIssues",
            query: LIST_QUERY,
            variables: {
              filter: linearIssueFilter({ ...input, teamId }),
              first: Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE),
              after: input.cursor ?? null,
            },
            decode: decodeList,
          }),
        ),
        Effect.map(({ issues }) => ({
          items: issues.nodes.map(toEntry),
          nextCursor: issues.pageInfo.hasNextPage ? (issues.pageInfo.endCursor ?? null) : null,
        })),
      ),
    getIssue: (project, id) =>
      configuredTeam(project, "getIssue").pipe(
        Effect.flatMap(({ apiKey, teamId }) =>
          graphql({
            apiKey,
            operation: "getIssue",
            query: DETAIL_QUERY,
            variables: { id },
            decode: decodeDetail,
          }).pipe(
            Effect.flatMap(({ issue }) =>
              // Only the project's own team: an id from the client must not read another team's.
              issue === null || issue.team?.id !== teamId
                ? Effect.fail(fail("getIssue", "not-found", `Issue ${id} was not found.`))
                : Effect.succeed(issue),
            ),
          ),
        ),
        Effect.map((issue): IssueDetail => ({
          ...toEntry(issue),
          body: issue.description ?? "",
          stateReason: STATE_REASONS[issue.state?.type ?? ""] ?? null,
          closedAt: issue.completedAt ?? issue.canceledAt ?? null,
          comments: issue.comments.nodes
            .map((comment): IssueComment => ({
              id: comment.id,
              author: toActor(comment.user),
              body: comment.body,
              createdAt: comment.createdAt,
              url: comment.url ?? null,
            }))
            .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
          ...(issue.comments.pageInfo.hasNextPage ? { moreComments: true } : {}),
        })),
      ),
  } satisfies IssueProviderApi;
});
