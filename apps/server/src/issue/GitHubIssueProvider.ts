/**
 * GitHub issues, read through the same GitHub API client, credentials, quota reserve and rate-limit
 * pause as pull requests. A project's issues are its own repository's: a listing is one
 * repository-scoped search, a detail one `repository.issue` read with its first comments.
 */
import {
  pullRequestHostOf,
  SourceControlProviderKind,
  type IssueAssigneeFilter,
  type IssueComment,
  type IssueDetail,
  type IssueListEntry,
  type IssueListState,
  type IssueStateReason,
  type PullRequestActor,
  type PullRequestLabel,
} from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import * as GitHubApi from "@t3tools/source-control-github/server/GitHubApi";
import { gitHubProviderFailure } from "@t3tools/source-control-github/server/GitHubPullRequestProvider";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { IssueProviderError, type IssueProject, type IssueProviderApi } from "./IssueProvider.ts";

/** GitHub serves at most a hundred rows per GraphQL page. */
const MAX_PAGE_SIZE = 100;
/** Comments a detail reads; past this the page points at GitHub for the rest. */
const DETAIL_COMMENT_LIMIT = 100;

/** A repository goes into the search query as itself, so it must be nothing but `owner/name`. */
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const ASSIGNEE_QUALIFIERS: Record<IssueAssigneeFilter, string | null> = {
  anyone: null,
  me: "assignee:@me",
  none: "no:assignee",
};

/** A value written into the search as one quoted term, so it cannot start a qualifier of its own. */
function quoted(value: string): string {
  return `"${value.replaceAll("\\", "").replaceAll('"', "")}"`;
}

/**
 * The listing as one GitHub search. Every word the reader typed is a quoted term: `repo:` or
 * `is:pr` would otherwise read beyond the project's own issues.
 */
export function issueSearchQuery(input: {
  readonly repository: string;
  readonly state: IssueListState;
  readonly assignee: IssueAssigneeFilter;
  readonly label: string | undefined;
  readonly query: string | undefined;
}): string {
  const assignee = ASSIGNEE_QUALIFIERS[input.assignee];
  const words = (input.query ?? "").split(/\s+/).filter((word) => word.length > 0);
  return [
    `repo:${input.repository}`,
    "is:issue",
    ...(input.state === "all" ? [] : [`is:${input.state}`]),
    ...(assignee === null ? [] : [assignee]),
    ...(input.label === undefined ? [] : [`label:${quoted(input.label)}`]),
    ...words.map(quoted),
    "sort:updated-desc",
  ].join(" ");
}

const ACTOR_FIELDS = "__typename login avatarUrl ... on User { name }";

const ISSUE_FIELDS = `
  number title url state createdAt updatedAt
  author { ${ACTOR_FIELDS} }
  labels(first: 20) { nodes { name color } }
  assignees(first: 10) { nodes { ${ACTOR_FIELDS} } }`;

const ISSUE_SEARCH_GRAPHQL_QUERY = `
query IssueSearch($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { __typename ... on Issue { ${ISSUE_FIELDS} comments { totalCount } } }
  }
}`;

/**
 * `stateReason` is asked for on github.com only: an older Enterprise server may not know it, and
 * an unknown field fails the whole read.
 */
const issueDetailGraphQlQuery = (withStateReason: boolean) => `
query IssueDetail($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${ISSUE_FIELDS}
      body closedAt${withStateReason ? " stateReason" : ""}
      comments(first: ${DETAIL_COMMENT_LIMIT}) {
        totalCount
        nodes { id url body createdAt author { ${ACTOR_FIELDS} } }
      }
    }
  }
}`;

const RawActor = Schema.Struct({
  __typename: Schema.optional(Schema.String),
  login: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawIssue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  author: Schema.optional(Schema.NullOr(RawActor)),
  labels: Schema.optional(
    Schema.NullOr(Schema.Struct({ nodes: Schema.Array(Schema.NullOr(RawLabel)) })),
  ),
  assignees: Schema.optional(
    Schema.NullOr(Schema.Struct({ nodes: Schema.Array(Schema.NullOr(RawActor)) })),
  ),
  comments: Schema.Struct({ totalCount: Schema.Number }),
});

const RawSearchResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.optional(Schema.NullOr(Schema.String)),
      }),
      // A search for issues still answers with `{}` for anything that is not one.
      nodes: Schema.Array(Schema.NullOr(Schema.Unknown)),
    }),
  }),
});

const RawComment = Schema.Struct({
  id: Schema.String,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.String,
  createdAt: Schema.String,
  author: Schema.optional(Schema.NullOr(RawActor)),
});

const RawDetailResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        issue: Schema.NullOr(
          Schema.Struct({
            ...RawIssue.fields,
            body: Schema.String,
            closedAt: Schema.optional(Schema.NullOr(Schema.String)),
            stateReason: Schema.optional(Schema.NullOr(Schema.String)),
            comments: Schema.Struct({
              totalCount: Schema.Number,
              nodes: Schema.Array(Schema.NullOr(RawComment)),
            }),
          }),
        ),
      }),
    ),
  }),
});

const decodeSearchResponse = decodeJsonResult(RawSearchResponse);
const decodeRawIssue = Schema.decodeUnknownOption(RawIssue);
const decodeDetailResponse = decodeJsonResult(RawDetailResponse);

function toActor(raw: typeof RawActor.Type | null | undefined): PullRequestActor | null {
  const login = raw?.login?.trim();
  if (login === undefined || login.length === 0) return null;
  return {
    login,
    name: raw?.name?.trim() || null,
    avatarUrl: raw?.avatarUrl?.trim() || null,
    ...(raw?.__typename === "Bot" ? { isBot: true } : {}),
  };
}

function toEntry(raw: typeof RawIssue.Type): IssueListEntry {
  return {
    id: String(raw.number),
    reference: `#${raw.number}`,
    title: raw.title,
    url: raw.url,
    state: raw.state === "CLOSED" ? "closed" : "open",
    author: toActor(raw.author),
    labels: (raw.labels?.nodes ?? []).flatMap((label): PullRequestLabel[] => {
      const name = label?.name.trim();
      return name ? [{ name, color: label?.color?.trim() || null }] : [];
    }),
    assignees: (raw.assignees?.nodes ?? []).flatMap((actor) => toActor(actor) ?? []),
    commentCount: raw.comments.totalCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const STATE_REASONS: Partial<Record<string, IssueStateReason>> = {
  COMPLETED: "completed",
  NOT_PLANNED: "not-planned",
  DUPLICATE: "duplicate",
};

export function decodeIssueSearchJson(
  raw: string,
): Result.Result<{ items: ReadonlyArray<IssueListEntry>; nextCursor: string | null }, unknown> {
  return Result.map(decodeSearchResponse(raw), ({ data: { search } }) => ({
    items: search.nodes.flatMap((node) => {
      const issue = decodeRawIssue(node);
      return issue._tag === "Some" ? [toEntry(issue.value)] : [];
    }),
    nextCursor: search.pageInfo.hasNextPage ? (search.pageInfo.endCursor ?? null) : null,
  }));
}

/** Null where GitHub answered that the repository or issue does not exist. */
export function decodeIssueDetailJson(raw: string): Result.Result<IssueDetail | null, unknown> {
  return Result.map(decodeDetailResponse(raw), ({ data }) => {
    const issue = data.repository?.issue;
    if (issue == null) return null;
    return {
      ...toEntry(issue),
      body: issue.body,
      closedAt: issue.closedAt ?? null,
      stateReason: STATE_REASONS[issue.stateReason ?? ""] ?? null,
      comments: issue.comments.nodes.flatMap((comment): IssueComment[] =>
        comment === null
          ? []
          : [
              {
                id: comment.id,
                author: toActor(comment.author),
                body: comment.body,
                createdAt: comment.createdAt,
                url: comment.url ?? null,
              },
            ],
      ),
    };
  });
}

export const make = Effect.gen(function* () {
  const api = yield* GitHubApi.GitHubApi;

  const fail = (operation: string, reason: IssueProviderError["reason"], detail: string) =>
    new IssueProviderError({ tracker: "github", operation, reason, detail });

  /** The project's own GitHub repository; anything else has no GitHub issues to read. */
  const repositoryOf = (
    project: IssueProject,
    operation: string,
  ): Effect.Effect<{ readonly repository: string; readonly host: string }, IssueProviderError> => {
    const identity = project.repositoryIdentity;
    const repository = sourceControlRepositorySelector(identity)?.trim() ?? null;
    if (identity?.provider !== "github" || repository === null || !REPOSITORY.test(repository)) {
      return Effect.fail(
        fail(operation, "unsupported", "This project is not a GitHub repository."),
      );
    }
    return Effect.succeed({
      repository,
      host: pullRequestHostOf(identity, SourceControlProviderKind.make("github")),
    });
  };

  const read = <A>(input: {
    readonly host: string;
    readonly operation: string;
    readonly query: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly decode: (raw: string) => Result.Result<A, unknown>;
  }) =>
    api
      .graphql({
        host: input.host,
        operation: input.operation,
        query: input.query,
        variables: input.variables,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new IssueProviderError({
              tracker: "github",
              operation: input.operation,
              reason: gitHubProviderFailure(error).reason,
              detail: error.message,
              cause: error,
            }),
        ),
        Effect.flatMap((raw) => {
          const decoded = input.decode(raw.trim());
          return Result.isSuccess(decoded)
            ? Effect.succeed(decoded.success)
            : Effect.fail(
                fail(input.operation, "failed", "GitHub answered in a shape T3 Code cannot read."),
              );
        }),
      );

  return {
    kind: "github",
    sourceName: (project) =>
      repositoryOf(project, "sourceName").pipe(Effect.map(({ repository }) => repository)),
    listIssues: (project, input) =>
      repositoryOf(project, "listIssues").pipe(
        Effect.flatMap(({ repository, host }) =>
          read({
            host,
            operation: "listIssues",
            query: ISSUE_SEARCH_GRAPHQL_QUERY,
            variables: {
              q: issueSearchQuery({ ...input, repository }),
              first: Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE),
              after: input.cursor ?? null,
            },
            decode: decodeIssueSearchJson,
          }),
        ),
      ),
    getIssue: (project, id) => {
      const number = /^[1-9][0-9]{0,9}$/.test(id) ? Number(id) : null;
      if (number === null) return Effect.fail(fail("getIssue", "not-found", `No issue #${id}.`));
      return repositoryOf(project, "getIssue").pipe(
        Effect.flatMap(({ repository, host }) => {
          const [owner, name] = repository.split("/");
          return read({
            host,
            operation: "getIssue",
            query: issueDetailGraphQlQuery(host === "github.com"),
            variables: { owner, name, number },
            decode: decodeIssueDetailJson,
          });
        }),
        Effect.filterOrFail(
          (issue) => issue !== null,
          () => fail("getIssue", "not-found", `Issue #${number} was not found.`),
        ),
      );
    },
  } satisfies IssueProviderApi;
});
