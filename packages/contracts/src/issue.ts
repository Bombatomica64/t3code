import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";

/**
 * The issue trackers this build can read. A tracker is not a source control host: a project's
 * repository decides where its pull requests live, while its issues may live in a tracker of
 * their own.
 */
export const IssueTrackerKind = Schema.Literals(["github"]);
export type IssueTrackerKind = typeof IssueTrackerKind.Type;

/** Where an issue stands, folded to the two states every tracker has. */
export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

/** What a listing asks for: one state, or both. */
export const IssueListState = Schema.Literals(["open", "closed", "all"]);
export type IssueListState = typeof IssueListState.Type;

/** Who an issue is assigned to, as a listing narrows it. */
export const IssueAssigneeFilter = Schema.Literals(["anyone", "me", "none"]);
export type IssueAssigneeFilter = typeof IssueAssigneeFilter.Type;

/** Why an issue was closed, where the tracker says. */
export const IssueStateReason = Schema.Literals(["completed", "not-planned", "duplicate"]);
export type IssueStateReason = typeof IssueStateReason.Type;

export const IssueListEntry = Schema.Struct({
  /** The tracker's own key for reading the issue again. Opaque to the client. */
  id: TrimmedNonEmptyString,
  /** How the tracker writes the issue's name: `#123` on GitHub. */
  reference: TrimmedNonEmptyString,
  title: Schema.String,
  url: TrimmedNonEmptyString,
  state: IssueState,
  /** The tracker's own name for the state, where it has finer ones than open and closed. */
  statusName: Schema.optional(TrimmedNonEmptyString),
  author: Schema.NullOr(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  assignees: Schema.Array(PullRequestActor),
  commentCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IssueListEntry = typeof IssueListEntry.Type;

const IssueQualifierValue = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

/** Which tracker of a project to read. The tracker decides where the project's issues live. */
export const IssueSourceInput = Schema.Struct({
  projectId: ProjectId,
  tracker: IssueTrackerKind,
});
export type IssueSourceInput = typeof IssueSourceInput.Type;

/** One page of a project's issues on one tracker, newest update first. */
export const IssueListInput = Schema.Struct({
  ...IssueSourceInput.fields,
  state: IssueListState,
  assignee: Schema.optional(IssueAssigneeFilter),
  /** One label name, matched the way the tracker matches it. */
  label: Schema.optional(IssueQualifierValue),
  /** Free text the tracker matches. Bounded because it travels into the tracker's own query. */
  query: Schema.optional(IssueQualifierValue),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  /** Opaque, handed back exactly as a previous page's `nextCursor` gave it. */
  cursor: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  entries: Schema.Array(IssueListEntry),
  /** Null once the tracker has nothing more to give. */
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueListResult = typeof IssueListResult.Type;

/** Addresses one issue, by the `id` its listing gave. */
export const IssueRef = Schema.Struct({
  ...IssueSourceInput.fields,
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type IssueRef = typeof IssueRef.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  url: Schema.NullOr(Schema.String),
});
export type IssueComment = typeof IssueComment.Type;

export const IssueDetail = Schema.Struct({
  ...IssueListEntry.fields,
  body: Schema.String,
  stateReason: Schema.NullOr(IssueStateReason),
  closedAt: Schema.NullOr(IsoDateTime),
  /**
   * The oldest comments, up to a bound. `commentCount` is the full count, so a page can say how
   * many more the tracker holds.
   */
  comments: Schema.Array(IssueComment),
});
export type IssueDetail = typeof IssueDetail.Type;

export const IssueErrorReason = Schema.Literals([
  /** The tracker has nothing to offer this project, such as GitHub for a GitLab checkout. */
  "unsupported",
  /** The tracker could serve this project once it is told where the project's issues live. */
  "not-configured",
  "missing-tool",
  "unauthenticated",
  "rate-limited",
  "not-found",
  "failed",
]);
export type IssueErrorReason = typeof IssueErrorReason.Type;

/**
 * One tracker as a project sees it. `available` sources can be listed; the rest carry the reason,
 * so the page can explain or offer the setup instead of failing a listing.
 */
export const IssueSource = Schema.Struct({
  tracker: IssueTrackerKind,
  available: Schema.Boolean,
  /** Where the issues are read from, as the page names it: `owner/repo` on GitHub. */
  name: Schema.NullOr(TrimmedNonEmptyString),
  reason: Schema.NullOr(IssueErrorReason),
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueSource = typeof IssueSource.Type;

export const IssueSourcesInput = Schema.Struct({ projectId: ProjectId });
export type IssueSourcesInput = typeof IssueSourcesInput.Type;

export const IssueSourcesResult = Schema.Struct({ sources: Schema.Array(IssueSource) });
export type IssueSourcesResult = typeof IssueSourcesResult.Type;

/**
 * Every way an issue read fails. The first four mean the project's issues cannot be read on this
 * tracker until something changes outside the page; the rest are specific to the request.
 */
export class IssueError extends Schema.TaggedError<IssueError>()("IssueError", {
  reason: IssueErrorReason,
  detail: TrimmedNonEmptyString,
  tracker: Schema.optional(IssueTrackerKind),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
