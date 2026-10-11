import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, IssueTrackerKind, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { useProjects, useServerConfigs } from "../state/entities";
import { shouldOpenPullRequestExternally } from "./openPullRequestLink";

/** An issue a link names, before it is matched to a project. */
export interface IssueLink {
  readonly tracker: IssueTrackerKind;
  /** The repository the issue lives in, as `host/owner/name`, lowercased. */
  readonly repositoryKey: string;
  /** The tracker's own key for the issue, as its listing would give it. */
  readonly issueId: string;
  readonly reference: string;
}

/**
 * A GitHub issue URL, `https://<host>/<owner>/<repo>/issues/<n>`, with anything after the number
 * (a comment anchor, a query) ignored. Null for anything else, a pull request included: GitHub
 * serves `/issues/<n>` for a pull request too, but redirects it, and a link that means a pull
 * request says `/pull/`.
 */
export function parseGitHubIssueUrl(url: string): IssueLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const match = /^\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]{0,9})\/?$/u.exec(parsed.pathname);
  if (match === null) return null;
  const [, owner, repo, number] = match;
  return {
    tracker: "github",
    repositoryKey: `${parsed.host}/${owner}/${repo}`.toLowerCase(),
    issueId: number!,
    reference: `#${number}`,
  };
}

/** The workspace project whose repository the issue lives in, if there is one. */
export function findProjectForIssue(
  projects: ReadonlyArray<EnvironmentProject>,
  link: IssueLink,
): EnvironmentProject | undefined {
  return projects.find(
    (project) => project.repositoryIdentity?.canonicalKey.toLowerCase() === link.repositoryKey,
  );
}

/**
 * Opens an issue link in T3 Code, and says whether it did. Beside a thread the issue opens as a
 * tab in the thread's panel, read through the thread's environment; anywhere else the Issues page
 * opens on it. A link to a repository no project here checks out stays an ordinary link.
 */
export function useOpenIssueLink(threadRef?: ScopedThreadRef) {
  const navigate = useNavigate();
  const allProjects = useProjects();
  const serverConfigs = useServerConfigs();
  return useCallback(
    (
      event: Pick<
        MouseEvent<HTMLElement>,
        "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
      >,
      url: string,
      environmentId?: EnvironmentId,
    ): boolean => {
      if (shouldOpenPullRequestExternally(event)) return false;
      const link = parseGitHubIssueUrl(url);
      if (link === null) return false;
      const scope = threadRef?.environmentId ?? environmentId;
      const project = findProjectForIssue(
        allProjects.filter(
          (candidate) =>
            (scope === undefined || candidate.environmentId === scope) &&
            serverConfigs.get(candidate.environmentId)?.environment.capabilities.issues === true,
        ),
        link,
      );
      if (project === undefined) return false;
      event.preventDefault();
      event.stopPropagation();
      if (threadRef) {
        useRightPanelStore.getState().openIssue(threadRef, {
          projectId: project.id,
          tracker: link.tracker,
          issueId: link.issueId,
          reference: link.reference,
        });
      } else {
        void navigate({
          to: "/issues",
          search: {
            environmentId: project.environmentId,
            projectId: project.id,
            tracker: link.tracker,
            issue: link.issueId,
          },
        });
      }
      return true;
    },
    [allProjects, navigate, serverConfigs, threadRef],
  );
}
