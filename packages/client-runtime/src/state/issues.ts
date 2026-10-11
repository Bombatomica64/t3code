import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * Issue reads for one environment. Each page of a listing is its own query, keyed by its cursor,
 * so loading more never re-reads the pages already shown, and a page revisited within the stale
 * time is served from memory. The server keeps its own short cache shared by every client.
 */
export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** Which trackers a project has. Rarely changes, so it is read once per visit. */
    sources: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:sources",
      tag: WS_METHODS.issuesSources,
      staleTimeMs: 5 * 60_000,
    }),
    /** Where a project's issues could live on a tracker, read fresh each time a picker opens. */
    sourceOptions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:source-options",
      tag: WS_METHODS.issuesSourceOptions,
      staleTimeMs: 0,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:list",
      tag: WS_METHODS.issuesList,
      staleTimeMs: 60_000,
    }),
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:detail",
      tag: WS_METHODS.issuesDetail,
      staleTimeMs: 60_000,
    }),
  };
}
