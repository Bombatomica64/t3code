import {
  IssueTrackerKind,
  type EnvironmentId,
  type IssueAssigneeFilter,
  type IssueListEntry,
  type IssueListState,
  type IssueSource,
  type ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo, type ReactNode } from "react";

import { issueEnvironment, usePaginatedIssues } from "~/state/issues";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";

import { PullRequestListGhost } from "../pullRequest/PullRequestGhosts";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  IssueFilterMenu,
  IssueListRow,
  IssueSearchInput,
  type IssueFilterOption,
} from "./IssueList";
import { IssueSourceMenu, IssueSourcePicker } from "./IssueSourcePicker";
import { ISSUE_TRACKERS } from "./issueTrackers";

/** What narrows a listing. The page keeps these in its URL, a thread's panel in its own state. */
export interface IssueBrowserFilters {
  readonly tracker?: IssueTrackerKind | undefined;
  readonly state: IssueListState;
  readonly assignee: IssueAssigneeFilter;
  readonly label?: string | undefined;
  readonly q: string;
}

export const DEFAULT_ISSUE_BROWSER_FILTERS: IssueBrowserFilters = {
  state: "open",
  assignee: "anyone",
  q: "",
};

/** A change to the filters; `undefined` clears `tracker` or `label`. */
export type IssueBrowserFiltersPatch = Partial<IssueBrowserFilters>;

export const isIssueTracker = Schema.is(IssueTrackerKind);

const STATE_OPTIONS: ReadonlyArray<IssueFilterOption<IssueListState>> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All states" },
];

const ASSIGNEE_OPTIONS: ReadonlyArray<IssueFilterOption<IssueAssigneeFilter>> = [
  { value: "anyone", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "none", label: "Unassigned" },
];

/** The "any label" choice, as a value no label name can be. */
const ANY_LABEL = "";
const SEARCH_DEBOUNCE_MS = 250;

/** What the browser says instead of a list when the project has no tracker it can read. */
function IssueSourceUnavailable({ source }: { source: IssueSource | null }) {
  const title =
    source === null
      ? "No issue tracker for this project"
      : source.reason === "not-configured"
        ? `${ISSUE_TRACKERS[source.tracker].label} is not set up for this project`
        : `Could not read ${ISSUE_TRACKERS[source.tracker].label} issues`;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {source?.detail ??
            "Issues can be browsed for projects on GitHub, or from a Linear team once a Linear API key is saved in Settings → Integrations."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * One project's issues: its trackers, the filters, and a paged list. Shared by the Issues page and
 * a thread's Issues panel, which differ only in where the filters live and what selecting does.
 */
export function IssueBrowser({
  environmentId,
  projectId,
  filters,
  onFiltersChange,
  selectedIssueId,
  onSelectIssue,
  renderHeader,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  filters: IssueBrowserFilters;
  onFiltersChange: (patch: IssueBrowserFiltersPatch) => void;
  selectedIssueId: string | null;
  onSelectIssue: (issue: IssueListEntry, tracker: IssueTrackerKind) => void;
  /** Lays out the header around the browser's own controls: tracker switch and refresh. */
  renderHeader: (controls: ReactNode) => ReactNode;
}) {
  const sourcesQuery = useEnvironmentQuery(
    issueEnvironment.sources({ environmentId, input: { projectId } }),
  );
  // A tracker that has nothing to do with this project is left out rather than explained.
  const offered = useMemo(
    () => (sourcesQuery.data?.sources ?? []).filter((source) => source.reason !== "unsupported"),
    [sourcesQuery.data],
  );
  const source = offered.find((candidate) => candidate.tracker === filters.tracker) ?? offered[0];

  const query = useDebouncedValue(filters.q, SEARCH_DEBOUNCE_MS);
  const listInput = source?.available
    ? {
        projectId,
        tracker: source.tracker,
        state: filters.state,
        ...(filters.assignee === "anyone" ? {} : { assignee: filters.assignee }),
        ...(filters.label ? { label: filters.label } : {}),
        ...(query ? { query } : {}),
      }
    : null;
  const issues = usePaginatedIssues(environmentId, listInput);

  // Labels to filter by, from the rows already loaded: no tracker lists a project's labels for
  // free, and the selected one stays on offer even when no loaded row carries it.
  const labelOptions = useMemo(() => {
    const names = new Set(
      issues.entries.flatMap((issue) => issue.labels.map((label) => label.name)),
    );
    if (filters.label) names.add(filters.label);
    return [
      { value: ANY_LABEL, label: "Any label" },
      ...[...names]
        .toSorted((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    ];
  }, [issues.entries, filters.label]);

  const filtered =
    filters.state !== "open" || filters.assignee !== "anyone" || filters.label !== undefined;
  // A new source changes what every listing means, so the pages already held start over.
  const refreshAfterSourceChange = () => {
    sourcesQuery.refresh();
    issues.refresh();
  };

  let body: ReactNode;
  if (sourcesQuery.error !== null && sourcesQuery.data === null) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load issues</EmptyTitle>
          <EmptyDescription>{sourcesQuery.error}</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" variant="outline" onClick={sourcesQuery.refresh}>
          <RefreshIcon size="sm" refreshing={sourcesQuery.isPending} />
          Retry
        </Button>
      </Empty>
    );
  } else if (sourcesQuery.data === null || (source?.available && issues.isLoading)) {
    body = <PullRequestListGhost />;
  } else if (
    source !== undefined &&
    !source.available &&
    ISSUE_TRACKERS[source.tracker].source !== undefined &&
    (source.reason === "not-configured" || source.reason === "not-found")
  ) {
    body = (
      <IssueSourcePicker
        environmentId={environmentId}
        projectId={projectId}
        tracker={source.tracker}
        detail={source.detail}
        onChanged={refreshAfterSourceChange}
      />
    );
  } else if (!source?.available) {
    body = <IssueSourceUnavailable source={source ?? null} />;
  } else if (issues.error !== null && issues.entries.length === 0) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load issues</EmptyTitle>
          <EmptyDescription>{issues.error}</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" variant="outline" onClick={issues.refresh}>
          <RefreshIcon size="sm" refreshing={issues.isRefreshing} />
          Retry
        </Button>
      </Empty>
    );
  } else if (issues.entries.length === 0) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {query
              ? `Nothing matches “${query.slice(0, 48)}”`
              : filtered
                ? "Nothing under these filters"
                : "No open issues"}
          </EmptyTitle>
          <EmptyDescription>
            {query || filtered
              ? "Try fewer words, or widen the filters."
              : `${source.name ?? "This project"} has no open issues.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    const tracker = source.tracker;
    body = (
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {issues.entries.map((issue) => (
          <IssueListRow
            key={issue.id}
            issue={issue}
            selected={issue.id === selectedIssueId}
            onSelect={() => onSelectIssue(issue, tracker)}
          />
        ))}
        {issues.hasMore || issues.error !== null ? (
          <div className="flex flex-col items-center gap-2 py-3">
            {issues.error !== null ? (
              <p className="text-xs text-destructive">{issues.error}</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={issues.isLoadingMore}
              onClick={issues.hasMore ? issues.loadMore : issues.refresh}
            >
              {issues.isLoadingMore ? "Loading..." : issues.hasMore ? "Load more issues" : "Retry"}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const controls = (
    <>
      {offered.length > 1 ? (
        <ToggleGroup
          aria-label="Issue tracker"
          value={source ? [source.tracker] : []}
          onValueChange={(value) => {
            const tracker = value[0];
            if (isIssueTracker(tracker)) onFiltersChange({ tracker, label: undefined });
          }}
        >
          {offered.map((candidate) => {
            const presentation = ISSUE_TRACKERS[candidate.tracker];
            return (
              <Toggle key={candidate.tracker} value={candidate.tracker} size="sm">
                <presentation.Icon className="size-3.5" />
                {presentation.label}
              </Toggle>
            );
          })}
        </ToggleGroup>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Refresh issues"
        disabled={listInput === null || issues.isRefreshing}
        onClick={issues.refresh}
      >
        <RefreshIcon size="sm" refreshing={issues.isRefreshing && !issues.isLoading} />
      </Button>
    </>
  );

  return (
    <>
      {renderHeader(controls)}
      {source?.available ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
          {ISSUE_TRACKERS[source.tracker].source !== undefined ? (
            <IssueSourceMenu
              environmentId={environmentId}
              projectId={projectId}
              tracker={source.tracker}
              name={source.name}
              onChanged={refreshAfterSourceChange}
            />
          ) : null}
          <IssueSearchInput
            value={filters.q}
            busy={filters.q.length > 0 && (filters.q !== query || issues.isRefreshing)}
            onChange={(value) => onFiltersChange({ q: value })}
          />
          <IssueFilterMenu
            label="State"
            value={filters.state}
            options={STATE_OPTIONS}
            onChange={(state) => onFiltersChange({ state })}
          />
          <IssueFilterMenu
            label="Assignee"
            value={filters.assignee}
            options={ASSIGNEE_OPTIONS}
            onChange={(assignee) => onFiltersChange({ assignee })}
          />
          <IssueFilterMenu
            label="Label"
            value={filters.label ?? ANY_LABEL}
            options={labelOptions}
            onChange={(label) => onFiltersChange({ label: label || undefined })}
          />
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
    </>
  );
}
