/**
 * IssueProvider — what an issue tracker implements so the Issues page can read it.
 *
 * Trackers are not source control hosts: GitHub reads a project's issues from its repository,
 * while another tracker may keep them somewhere the repository says nothing about. So each call
 * hands the provider the whole project and the provider decides where its issues live, failing
 * with `unsupported` or `not-configured` where it cannot say.
 *
 * Read-only. Everything a provider returns is already in the contract's tracker-neutral shape.
 */
import type {
  IssueAssigneeFilter,
  IssueDetail,
  IssueErrorReason,
  IssueListEntry,
  IssueListState,
  IssueTrackerKind,
  ProjectId,
  RepositoryIdentity,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export class IssueProviderError extends Data.TaggedError("IssueProviderError")<{
  readonly tracker: IssueTrackerKind;
  readonly operation: string;
  readonly reason: IssueErrorReason;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `${this.tracker} failed in ${this.operation}: ${this.detail}`;
  }
}

/** The project as a tracker sees it. */
export interface IssueProject {
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly repositoryIdentity: RepositoryIdentity | null;
}

export interface ProviderIssueQuery {
  readonly state: IssueListState;
  readonly assignee: IssueAssigneeFilter;
  readonly label: string | undefined;
  readonly query: string | undefined;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export interface ProviderIssuePage {
  readonly items: ReadonlyArray<IssueListEntry>;
  /** Opaque to everyone but the provider that issued it; null on the last page. */
  readonly nextCursor: string | null;
}

export interface IssueProviderApi {
  readonly kind: IssueTrackerKind;
  /** Where this project's issues live on the tracker, named for the page. */
  readonly sourceName: (project: IssueProject) => Effect.Effect<string, IssueProviderError>;
  readonly listIssues: (
    project: IssueProject,
    query: ProviderIssueQuery,
  ) => Effect.Effect<ProviderIssuePage, IssueProviderError>;
  /** `id` is an entry's own `id`, as a listing handed it over. */
  readonly getIssue: (
    project: IssueProject,
    id: string,
  ) => Effect.Effect<IssueDetail, IssueProviderError>;
}
