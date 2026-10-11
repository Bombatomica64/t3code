import {
  IssueAssigneeFilter,
  IssueListState,
  type EnvironmentId,
  type IssueTrackerKind,
  type ProjectId,
} from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useCallback, useMemo } from "react";

import {
  IssueBrowser,
  isIssueTracker,
  type IssueBrowserFiltersPatch,
} from "../components/issue/IssueBrowser";
import { IssueDetailPanel } from "../components/issue/IssueDetailPanel";
import { IssueFilterMenu } from "../components/issue/IssueList";
import { issueProjectOptions, resolveIssueProject } from "../components/issue/issueProjects.logic";
import { PullRequestListGhost } from "../components/pullRequest/PullRequestGhosts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import { cn } from "../lib/utils";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";

export interface IssuesSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly tracker?: IssueTrackerKind;
  readonly state?: IssueListState;
  readonly assignee?: IssueAssigneeFilter;
  readonly label?: string;
  readonly q?: string;
  /** The open issue, as its listing's `id`. */
  readonly issue?: string;
}

/** A change to the URL; `undefined` clears a key. */
type IssuesSearchPatch = { readonly [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined };

const isListState = Schema.is(IssueListState);
const isAssignee = Schema.is(IssueAssigneeFilter);

/** A bounded, non-empty string from the URL, or nothing. */
const urlText = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 200) : undefined;

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => {
    const environmentId = urlText(raw.environmentId);
    const projectId = urlText(raw.projectId);
    const label = urlText(raw.label);
    const q = urlText(raw.q);
    // A hand-typed `issue=123` arrives parsed as a number.
    const issue = urlText(typeof raw.issue === "number" ? String(raw.issue) : raw.issue);
    return {
      ...(environmentId ? { environmentId: environmentId as EnvironmentId } : {}),
      ...(projectId ? { projectId: projectId as ProjectId } : {}),
      ...(isIssueTracker(raw.tracker) ? { tracker: raw.tracker } : {}),
      ...(isListState(raw.state) && raw.state !== "open" ? { state: raw.state } : {}),
      ...(isAssignee(raw.assignee) && raw.assignee !== "anyone" ? { assignee: raw.assignee } : {}),
      ...(label ? { label } : {}),
      ...(q ? { q } : {}),
      ...(issue ? { issue } : {}),
    };
  },
  component: IssuesRouteView,
});

function IssuesRouteView() {
  useEscapeToGoBack();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const updateSearch = useCallback(
    (patch: IssuesSearchPatch) =>
      navigate({
        search: (previous) => {
          const next: Record<string, unknown> = { ...previous, ...patch };
          for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
          return next as IssuesSearch;
        },
        replace: true,
      }),
    [navigate],
  );
  // Defaults stay out of the URL, and a new search or tracker closes the issue it no longer lists.
  const updateFilters = useCallback(
    (patch: IssueBrowserFiltersPatch) =>
      void updateSearch({
        ...("tracker" in patch ? { tracker: patch.tracker, issue: undefined } : {}),
        ...("state" in patch ? { state: patch.state === "open" ? undefined : patch.state } : {}),
        ...("assignee" in patch
          ? { assignee: patch.assignee === "anyone" ? undefined : patch.assignee }
          : {}),
        ...("label" in patch ? { label: patch.label } : {}),
        ...("q" in patch ? { q: patch.q || undefined, issue: undefined } : {}),
      }),
    [updateSearch],
  );

  const { environments } = useEnvironments();
  const supportedEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) => environment.serverConfig?.environment.capabilities.issues === true,
          )
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const allProjects = useProjects();
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  const projectOptions = useMemo(
    () => issueProjectOptions(allProjects, supportedEnvironmentIds),
    [allProjects, supportedEnvironmentIds],
  );
  const project = resolveIssueProject(projectOptions, search);
  const selectedIssue =
    search.issue !== undefined && project !== null
      ? { projectId: project.projectId, tracker: search.tracker ?? "github", id: search.issue }
      : null;

  const header = (controls: React.ReactNode) => (
    <WorkspacePageHeader electron={isElectron} className="bg-background">
      <WorkspaceBreadcrumb ariaLabel="Issues scope" className="min-w-0 overflow-hidden">
        <WorkspaceBreadcrumbItem current>
          <h1 className="truncate">Issues</h1>
        </WorkspaceBreadcrumbItem>
        {projectOptions.length > 0 && project !== null ? (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem className="min-w-0 shrink">
              <IssueFilterMenu
                label="Project"
                value={project.key}
                options={projectOptions.map((option) => ({
                  value: option.key,
                  label: option.title,
                }))}
                onChange={(key) => {
                  const next = projectOptions.find((option) => option.key === key);
                  if (!next) return;
                  void updateSearch({
                    environmentId: next.environmentId,
                    projectId: next.projectId,
                    issue: undefined,
                    label: undefined,
                  });
                }}
              />
            </WorkspaceBreadcrumbItem>
          </>
        ) : null}
      </WorkspaceBreadcrumb>
      <div className="ml-auto flex shrink-0 items-center gap-1">{controls}</div>
    </WorkspacePageHeader>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col bg-background",
            selectedIssue !== null && "hidden md:flex md:max-w-[50%]",
          )}
        >
          {project === null ? (
            <>
              {header(null)}
              {projectsKnown ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No projects to show issues for</EmptyTitle>
                    <EmptyDescription>
                      Add a project whose repository is on GitHub, and its issues appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <PullRequestListGhost />
              )}
            </>
          ) : (
            <IssueBrowser
              key={project.key}
              environmentId={project.environmentId}
              projectId={project.projectId}
              filters={{
                tracker: search.tracker,
                state: search.state ?? "open",
                assignee: search.assignee ?? "anyone",
                label: search.label,
                q: search.q ?? "",
              }}
              onFiltersChange={updateFilters}
              selectedIssueId={search.issue ?? null}
              onSelectIssue={(issue, tracker) => void updateSearch({ issue: issue.id, tracker })}
              renderHeader={header}
            />
          )}
        </div>

        {selectedIssue !== null && project !== null ? (
          <div className="flex min-h-0 min-w-0 flex-1 border-border md:border-l">
            <IssueDetailPanel
              key={`${project.key}\u0000${selectedIssue.tracker}\u0000${selectedIssue.id}`}
              environmentId={project.environmentId}
              reference={selectedIssue}
              cwd={project.workspaceRoot}
              onClose={() => void updateSearch({ issue: undefined })}
            />
          </div>
        ) : null}
      </div>
    </SidebarInset>
  );
}
