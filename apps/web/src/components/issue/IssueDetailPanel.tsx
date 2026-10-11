import type { EnvironmentId, IssueComment, IssueRef } from "@t3tools/contracts";
import { ExternalLinkIcon, XIcon } from "lucide-react";

import { useEnvironmentQuery } from "~/state/query";
import { issueEnvironment } from "~/state/issues";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
  PullRequestMetaLine,
} from "../pullRequest/pullRequestPresentation";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { IssueStateGlyph } from "./IssueList";
import { ISSUE_TRACKERS } from "./issueTrackers";

function IssueFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 text-xs">
      <span className="w-20 shrink-0 pt-0.5 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function IssueCommentItem({
  comment,
  cwd,
  environmentId,
}: {
  comment: IssueComment;
  cwd: string;
  environmentId: EnvironmentId;
}) {
  return (
    <li className="rounded-lg border border-border/70">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
        <PullRequestActorLabel actor={comment.author} />
        <span className="ml-auto shrink-0 tabular-nums">
          {formatRelativeTimeLabel(comment.createdAt)}
        </span>
      </div>
      <div className="px-3 py-2.5 text-sm">
        {comment.body.trim().length > 0 ? (
          <PullRequestMarkdown text={comment.body} cwd={cwd} environmentId={environmentId} />
        ) : (
          <p className="text-muted-foreground italic">No content.</p>
        )}
      </div>
    </li>
  );
}

/**
 * One issue in full: what it says, who is on it, and its conversation, with the tracker one click
 * away for everything this read-only view leaves out.
 */
export function IssueDetailPanel({
  environmentId,
  reference,
  cwd,
  onClose,
}: {
  environmentId: EnvironmentId;
  reference: IssueRef;
  /** The project's checkout, which relative links in the issue's markdown resolve against. */
  cwd: string;
  /** Absent beside a thread, where the surface tab's own X owns closing. */
  onClose?: (() => void) | undefined;
}) {
  const query = useEnvironmentQuery(issueEnvironment.detail({ environmentId, input: reference }));
  const issue = query.data;
  const tracker = ISSUE_TRACKERS[reference.tracker];
  const openLabel = `Open in ${tracker.label}`;
  // How many comments the tracker holds past those shown: 0 where it says there are more but not
  // how many, null where there are none.
  const moreComments =
    issue === null
      ? null
      : issue.commentCount !== null
        ? issue.commentCount > issue.comments.length
          ? issue.commentCount - issue.comments.length
          : null
        : issue.moreComments === true
          ? 0
          : null;

  return (
    <section aria-label="Issue" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {issue?.reference ?? ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {issue ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              {openLabel}
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh issue"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshIcon size="sm" refreshing={query.isPending && issue !== null} />
          </Button>
          {onClose ? (
            <Button size="icon-sm" variant="ghost" aria-label="Close issue" onClick={onClose}>
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {issue === null ? (
        query.error !== null ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Could not load the issue</EmptyTitle>
              <EmptyDescription>{query.error}</EmptyDescription>
            </EmptyHeader>
            <Button size="sm" variant="outline" onClick={query.refresh}>
              <RefreshIcon size="sm" refreshing={query.isPending} />
              Retry
            </Button>
          </Empty>
        ) : (
          <div role="status" aria-label="Loading issue" className="flex flex-1 justify-center p-8">
            <Spinner />
          </div>
        )
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <article className="flex flex-col gap-5 px-5 py-4">
            <header className="flex flex-col gap-2">
              <h2 className="text-lg leading-snug font-semibold text-foreground">{issue.title}</h2>
              <PullRequestMetaLine className="text-xs text-muted-foreground">
                <span key="state" className="flex items-center gap-1">
                  <IssueStateGlyph issue={issue} className="size-3.5" />
                  {issue.statusName ?? (issue.state === "open" ? "Open" : "Closed")}
                </span>
                <span key="author" className="flex min-w-0 items-center gap-1">
                  <PullRequestActorLabel actor={issue.author} />
                  <span className="shrink-0">
                    opened {formatRelativeTimeLabel(issue.createdAt)}
                  </span>
                </span>
                {issue.closedAt ? (
                  <span key="closed">closed {formatRelativeTimeLabel(issue.closedAt)}</span>
                ) : null}
              </PullRequestMetaLine>
            </header>

            <div className="flex flex-col gap-2">
              <IssueFact label="Assignees">
                {issue.assignees.length > 0 ? (
                  issue.assignees.map((assignee) => (
                    <PullRequestActorLabel key={assignee.login} actor={assignee} />
                  ))
                ) : (
                  <span className="text-muted-foreground">No one</span>
                )}
              </IssueFact>
              <IssueFact label="Labels">
                {issue.labels.length > 0 ? (
                  issue.labels.map((label) => (
                    <PullRequestLabelChip key={label.name} label={label} />
                  ))
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </IssueFact>
            </div>

            <div className="text-sm">
              {issue.body.trim().length > 0 ? (
                <PullRequestMarkdown text={issue.body} cwd={cwd} environmentId={environmentId} />
              ) : (
                <p className="text-muted-foreground italic">No description provided.</p>
              )}
            </div>

            <section aria-label="Comments" className="flex flex-col gap-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                {issue.commentCount === null
                  ? "Comments"
                  : issue.commentCount === 1
                    ? "1 comment"
                    : `${issue.commentCount} comments`}
              </h3>
              {issue.comments.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {issue.comments.map((comment) => (
                    <IssueCommentItem
                      key={comment.id}
                      comment={comment}
                      cwd={cwd}
                      environmentId={environmentId}
                    />
                  ))}
                </ul>
              ) : null}
              {moreComments !== null ? (
                <a
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {moreComments === 0 ? "More" : `${moreComments} more`} on {tracker.label}
                </a>
              ) : null}
            </section>
          </article>
        </ScrollArea>
      )}
    </section>
  );
}
