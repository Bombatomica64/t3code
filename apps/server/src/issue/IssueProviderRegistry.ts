import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { IssueTrackerKind } from "@t3tools/contracts";

import * as BuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import * as GitHubIssueProvider from "./GitHubIssueProvider.ts";
import type { IssueProviderApi } from "./IssueProvider.ts";

export class IssueProviderRegistry extends Context.Service<
  IssueProviderRegistry,
  {
    readonly get: (kind: IssueTrackerKind) => IssueProviderApi | null;
    /** Every tracker this build can read, in the order the page offers them. */
    readonly all: ReadonlyArray<IssueProviderApi>;
  }
>()("t3/issue/IssueProviderRegistry") {}

/** Exported for tests, which stand a registry up from providers they supply themselves. */
export function fromProviders(
  providers: ReadonlyArray<IssueProviderApi>,
): IssueProviderRegistry["Service"] {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return { get: (kind) => byKind.get(kind) ?? null, all: providers };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  return fromProviders([yield* GitHubIssueProvider.make]);
});

export const layer = Layer.effect(IssueProviderRegistry, make).pipe(
  // The same GitHub client pull requests read through, so issues share its credentials, quota
  // reserve and rate-limit pause rather than spending a second budget against the same account.
  Layer.provide(BuiltInDrivers.layer),
);
