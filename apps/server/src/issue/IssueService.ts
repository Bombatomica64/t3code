import {
  IssueError,
  type IssueDetail,
  type IssueListInput,
  type IssueListResult,
  type IssueRef,
  type IssueSource,
  type IssueSourceInput,
  type IssueSourcesInput,
  type IssueSourcesResult,
  type ProjectId,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import type { IssueProject, IssueProviderApi, IssueProviderError } from "./IssueProvider.ts";
import * as IssueProviderRegistry from "./IssueProviderRegistry.ts";

/** Rows per page when the client does not ask for a size. */
const DEFAULT_PAGE_SIZE = 50;
/**
 * How long a page or detail is served from memory. Long enough that reopening the page or flipping
 * between issues costs nothing; short enough that a new comment shows on the next refresh.
 */
const READ_TTL = Duration.seconds(30);
const CACHE_CAPACITY = 256;

/** Reads a project's issues from whichever trackers it has. The server owns every tracker call. */
export class IssueService extends Context.Service<
  IssueService,
  {
    readonly sources: (input: IssueSourcesInput) => Effect.Effect<IssueSourcesResult, IssueError>;
    readonly list: (input: IssueListInput) => Effect.Effect<IssueListResult, IssueError>;
    readonly detail: (input: IssueRef) => Effect.Effect<IssueDetail, IssueError>;
  }
>()("t3/issue/IssueService") {}

const toIssueError = (error: IssueProviderError) =>
  new IssueError({
    reason: error.reason,
    detail: error.detail.trim() || "The issue read failed.",
    tracker: error.tracker,
    cause: error,
  });

export const make = Effect.gen(function* () {
  const registry = yield* IssueProviderRegistry.IssueProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const repositoryIdentities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;

  const resolveProject = Effect.fn("IssueService.resolveProject")(function* (projectId: ProjectId) {
    const shell = yield* projects
      .getShell(projectId)
      .pipe(
        Effect.mapError(
          (cause) =>
            new IssueError({ reason: "failed", detail: "The project could not be read.", cause }),
        ),
      );
    if (Option.isNone(shell)) {
      return yield* new IssueError({
        reason: "not-found",
        detail: "The project no longer exists.",
      });
    }
    const project = shell.value;
    return {
      id: project.id,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity:
        project.repositoryIdentity ?? (yield* repositoryIdentities.resolve(project.workspaceRoot)),
    } satisfies IssueProject;
  });

  const resolve = (input: IssueSourceInput) =>
    Effect.gen(function* () {
      const provider: IssueProviderApi | null = registry.get(input.tracker);
      if (provider === null) {
        return yield* new IssueError({
          reason: "unsupported",
          detail: "This server cannot read that issue tracker.",
          tracker: input.tracker,
        });
      }
      return { provider, project: yield* resolveProject(input.projectId) };
    });

  const listUncached = Effect.fn("IssueService.list")(function* (input: IssueListInput) {
    const { provider, project } = yield* resolve(input);
    const page = yield* provider
      .listIssues(project, {
        state: input.state,
        assignee: input.assignee ?? "anyone",
        label: input.label,
        query: input.query,
        limit: input.limit ?? DEFAULT_PAGE_SIZE,
        cursor: input.cursor,
      })
      .pipe(Effect.mapError(toIssueError));
    return { entries: page.items, nextCursor: page.nextCursor } satisfies IssueListResult;
  });

  const detailUncached = Effect.fn("IssueService.detail")(function* (input: IssueRef) {
    const { provider, project } = yield* resolve(input);
    return yield* provider.getIssue(project, input.id).pipe(Effect.mapError(toIssueError));
  });

  // Keys are the serialized input, so identical reads from several clients coalesce into one
  // tracker request. Failures are not kept: a retry after signing in must reach the tracker.
  const timeToLive = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isSuccess(exit) ? READ_TTL : Duration.zero;
  const listCache = yield* Cache.makeWith(
    (key: string) => listUncached(JSON.parse(key) as IssueListInput),
    { capacity: CACHE_CAPACITY, timeToLive },
  );
  const detailCache = yield* Cache.makeWith(
    (key: string) => detailUncached(JSON.parse(key) as IssueRef),
    { capacity: CACHE_CAPACITY, timeToLive },
  );

  /** Every tracker, each saying whether it can serve this project and, if not, why. */
  const sources = Effect.fn("IssueService.sources")(function* (input: IssueSourcesInput) {
    const project = yield* resolveProject(input.projectId);
    const sources = yield* Effect.forEach(
      registry.all,
      (provider) =>
        provider.sourceName(project).pipe(
          Effect.match({
            onSuccess: (name): IssueSource => ({
              tracker: provider.kind,
              available: true,
              name,
              reason: null,
              detail: null,
            }),
            onFailure: (error): IssueSource => ({
              tracker: provider.kind,
              available: false,
              name: null,
              reason: error.reason,
              detail: error.detail.trim() || null,
            }),
          }),
        ),
      { concurrency: "unbounded" },
    );
    return { sources } satisfies IssueSourcesResult;
  });

  return IssueService.of({
    sources,
    // Keys list every field in a fixed order, so the same read is one key however it was built.
    list: (input) =>
      Cache.get(
        listCache,
        JSON.stringify({
          projectId: input.projectId,
          tracker: input.tracker,
          state: input.state,
          assignee: input.assignee,
          label: input.label,
          query: input.query,
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
    detail: (input) =>
      Cache.get(
        detailCache,
        JSON.stringify({ projectId: input.projectId, tracker: input.tracker, id: input.id }),
      ),
  });
});

export const layer = Layer.effect(IssueService, make);
