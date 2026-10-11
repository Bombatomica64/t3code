import { useAtomValue } from "@effect/atom-react";
import { createIssueEnvironmentAtoms } from "@t3tools/client-runtime/state/issues";
import type {
  EnvironmentId,
  IssueError,
  IssueListEntry,
  IssueListInput,
  IssueListResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "./query";

export const issueEnvironment = createIssueEnvironmentAtoms(connectionAtomRuntime);

/** Rows per page. Small enough to arrive quickly, large enough that most lists are one page. */
const ISSUE_PAGE_SIZE = 50;

const FIRST_PAGE: ReadonlyArray<string | undefined> = [undefined];

/**
 * The pages loaded so far as one list. An issue updated while the reader pages moves to the top
 * of a fresh read and can be handed over again by a later page, so the first sighting wins.
 */
export function mergeIssuePages(pages: ReadonlyArray<IssueListResult>): {
  readonly entries: ReadonlyArray<IssueListEntry>;
  readonly nextCursor: string | null;
} {
  const seen = new Set<string>();
  const entries: IssueListEntry[] = [];
  for (const page of pages) {
    for (const entry of page.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return { entries, nextCursor: pages.at(-1)?.nextCursor ?? null };
}

/**
 * A project's issues on one tracker, a page at a time. Each page is its own cached query keyed by
 * its cursor, so loading more reads one page and returning to a list redraws it from memory.
 */
export function usePaginatedIssues(
  environmentId: EnvironmentId | null,
  input: Omit<IssueListInput, "cursor" | "limit"> | null,
) {
  const targetKey =
    environmentId !== null && input !== null ? JSON.stringify([environmentId, input]) : null;
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<string | undefined>;
  }>({ targetKey, cursors: FIRST_PAGE });
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : FIRST_PAGE;
  // Read back out of `targetKey` rather than closed over: `input` is a fresh object every render.
  const pageAtoms = useMemo(() => {
    if (targetKey === null) return [];
    const [target, query] = JSON.parse(targetKey) as [EnvironmentId, IssueListInput];
    return cursors.map((cursor) =>
      issueEnvironment.list({
        environmentId: target,
        input: { ...query, limit: ISSUE_PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      }),
    );
  }, [cursors, targetKey]);
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`web:issue-pages:${targetKey ?? "empty"}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const merged = useMemo(
    () => mergeIssuePages(results.flatMap((result) => Option.toArray(AsyncResult.value(result)))),
    [results],
  );
  const failed = results.find((result) => result._tag === "Failure");
  const failure =
    failed?._tag === "Failure"
      ? (Option.getOrNull(Cause.findErrorOption(failed.cause)) as IssueError | null)
      : null;

  const refresh = useCallback(() => {
    setPagination({ targetKey, cursors: FIRST_PAGE });
    const firstPage = pageAtoms[0];
    if (firstPage !== undefined) appAtomRegistry.refresh(firstPage);
  }, [pageAtoms, targetKey]);
  const nextCursor = merged.nextCursor;
  const loadMore = useCallback(() => {
    if (targetKey === null || nextCursor === null) return;
    setPagination((current) => {
      const loaded = current.targetKey === targetKey ? current.cursors : FIRST_PAGE;
      return loaded.includes(nextCursor)
        ? current
        : { targetKey, cursors: [...loaded, nextCursor] };
    });
  }, [nextCursor, targetKey]);

  return {
    entries: merged.entries,
    /** Nothing has arrived yet for the first page. */
    isLoading:
      pageAtoms.length > 0 &&
      failed === undefined &&
      results.every((result) => Option.isNone(AsyncResult.value(result))),
    isRefreshing: results.some((result) => result.waiting),
    isLoadingMore: results.length > 1 && (results.at(-1)?.waiting ?? false),
    hasMore: nextCursor !== null,
    error: failed?._tag === "Failure" ? formatEnvironmentQueryError(failed.cause) : null,
    failure,
    refresh,
    loadMore,
  };
}
