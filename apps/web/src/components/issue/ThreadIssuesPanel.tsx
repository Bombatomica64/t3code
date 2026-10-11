import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useRightPanelStore } from "~/rightPanelStore";

import {
  DEFAULT_ISSUE_BROWSER_FILTERS,
  IssueBrowser,
  type IssueBrowserFilters,
} from "./IssueBrowser";

/**
 * The thread project's issues beside the thread. Selecting one opens it as its own tab, the way a
 * pull request opens, so several can stay at hand while the list keeps its place.
 */
export function ThreadIssuesPanel({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
}) {
  const [filters, setFilters] = useState<IssueBrowserFilters>(DEFAULT_ISSUE_BROWSER_FILTERS);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <IssueBrowser
        environmentId={threadRef.environmentId}
        projectId={projectId}
        filters={filters}
        onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        selectedIssueId={null}
        onSelectIssue={(issue, tracker) =>
          useRightPanelStore.getState().openIssue(threadRef, {
            projectId,
            tracker,
            issueId: issue.id,
            reference: issue.reference,
          })
        }
        renderHeader={(controls) => (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="text-sm font-medium">Issues</span>
            <div className="ml-auto flex items-center gap-1">{controls}</div>
          </div>
        )}
      />
    </div>
  );
}
