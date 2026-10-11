import { assert, describe, it } from "@effect/vitest";
import type { IssueListEntry, OrchestrationProjectShell, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { IssueProviderError, type IssueProviderApi } from "./IssueProvider.ts";
import * as IssueProviderRegistry from "./IssueProviderRegistry.ts";
import * as IssueService from "./IssueService.ts";

const project = {
  id: "project-1" as ProjectId,
  title: "web",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
} as unknown as OrchestrationProjectShell;

const entry: IssueListEntry = {
  id: "1",
  reference: "#1",
  title: "First",
  url: "https://github.com/acme/web/issues/1",
  state: "open",
  author: null,
  labels: [],
  assignees: [],
  commentCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

function makeService(provider: IssueProviderApi) {
  return IssueService.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(
          IssueProviderRegistry.IssueProviderRegistry,
          IssueProviderRegistry.fromProviders([provider]),
        ),
        Layer.mock(ProjectService.ProjectService)({
          getShell: (projectId) =>
            Effect.succeed(projectId === project.id ? Option.some(project) : Option.none()),
        }),
        Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
          resolve: () => Effect.succeed(null),
        }),
      ),
    ),
  );
}

function fakeProvider(overrides: Partial<IssueProviderApi> = {}): IssueProviderApi {
  return {
    kind: "github",
    sourceName: () => Effect.succeed("acme/web"),
    listIssues: () => Effect.succeed({ items: [entry], nextCursor: null }),
    getIssue: () => Effect.die("unused"),
    ...overrides,
  };
}

describe("IssueService", () => {
  it.effect("reports each tracker's availability for a project", () =>
    Effect.gen(function* () {
      const available = yield* makeService(fakeProvider());
      assert.deepStrictEqual(yield* available.sources({ projectId: project.id }), {
        sources: [
          { tracker: "github", available: true, name: "acme/web", reason: null, detail: null },
        ],
      });

      const unsupported = yield* makeService(
        fakeProvider({
          sourceName: () =>
            Effect.fail(
              new IssueProviderError({
                tracker: "github",
                operation: "sourceName",
                reason: "unsupported",
                detail: "This project is not a GitHub repository.",
              }),
            ),
        }),
      );
      const { sources } = yield* unsupported.sources({ projectId: project.id });
      assert.strictEqual(sources[0]?.available, false);
      assert.strictEqual(sources[0]?.reason, "unsupported");
    }),
  );

  it.effect("serves an identical page from its cache", () =>
    Effect.gen(function* () {
      let reads = 0;
      const service = yield* makeService(
        fakeProvider({
          listIssues: () =>
            Effect.sync(() => {
              reads++;
              return { items: [entry], nextCursor: null };
            }),
        }),
      );
      const input = { projectId: project.id, tracker: "github", state: "open" } as const;
      yield* service.list(input);
      const again = yield* service.list({ ...input });
      assert.strictEqual(reads, 1);
      assert.deepStrictEqual(again, { entries: [entry], nextCursor: null });
      yield* service.list({ ...input, cursor: "next" });
      assert.strictEqual(reads, 2);
    }),
  );

  it.effect("does not keep a failure, so a retry reaches the tracker", () =>
    Effect.gen(function* () {
      let reads = 0;
      const service = yield* makeService(
        fakeProvider({
          listIssues: () =>
            Effect.suspend(() =>
              ++reads === 1
                ? Effect.fail(
                    new IssueProviderError({
                      tracker: "github",
                      operation: "listIssues",
                      reason: "unauthenticated",
                      detail: "Sign in to GitHub.",
                    }),
                  )
                : Effect.succeed({ items: [entry], nextCursor: null }),
            ),
        }),
      );
      const input = { projectId: project.id, tracker: "github", state: "open" } as const;
      const error = yield* Effect.flip(service.list(input));
      assert.strictEqual(error.reason, "unauthenticated");
      assert.strictEqual(error.message, "Sign in to GitHub.");
      yield* service.list(input);
      assert.strictEqual(reads, 2);
    }),
  );

  it.effect("fails a read for a project that no longer exists", () =>
    Effect.gen(function* () {
      const service = yield* makeService(fakeProvider());
      const error = yield* Effect.flip(
        service.detail({ projectId: "gone" as ProjectId, tracker: "github", id: "1" }),
      );
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});
