import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, IssueTrackerKind, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

import { useRightPanelStore } from "../rightPanelStore";
import { readThreadShell, useProjects, useServerConfigs } from "../state/entities";
import { shouldOpenPullRequestExternally } from "./openPullRequestLink";

/** An issue a link names, before it is matched to a project. */
export interface IssueLink {
  readonly tracker: IssueTrackerKind;
  /**
   * The repository the issue lives in, as `host/owner/name`, lowercased. Null for a tracker whose
   * links name no repository, which a thread then reads through its own project.
   */
  readonly repositoryKey: string | null;
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

/**
 * A Linear issue URL, `https://linear.app/<workspace>/issue/<TEAM-123>/<slug>`. The identifier is
 * what the Linear provider reads an issue by; the workspace and slug are only decoration.
 */
export function parseLinearIssueUrl(url: string): IssueLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.host.toLowerCase() !== "linear.app") return null;
  const match =
    /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9_]{0,15}-[1-9][0-9]{0,9})(?:\/[^/]*)?\/?$/u.exec(
      parsed.pathname,
    );
  if (match === null) return null;
  const identifier = match[1]!.toUpperCase();
  return { tracker: "linear", repositoryKey: null, issueId: identifier, reference: identifier };
}

/** The issue any supported tracker's link names. */
export function parseIssueUrl(url: string): IssueLink | null {
  return parseGitHubIssueUrl(url) ?? parseLinearIssueUrl(url);
}

/** The workspace project whose repository the issue lives in, if there is one. */
export function findProjectForIssue(
  projects: ReadonlyArray<EnvironmentProject>,
  link: IssueLink,
): EnvironmentProject | undefined {
  if (link.repositoryKey === null) return undefined;
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
      const link = parseIssueUrl(url);
      if (link === null) return false;
      const scope = threadRef?.environmentId ?? environmentId;
      const candidates = allProjects.filter(
        (candidate) =>
          (scope === undefined || candidate.environmentId === scope) &&
          serverConfigs.get(candidate.environmentId)?.environment.capabilities.issues === true,
      );
      // A link that names no repository is read through the thread's own project, whose tracker
      // settings say where its issues live; with no thread there is no project to read it through.
      const threadProjectId =
        link.repositoryKey === null && threadRef
          ? readThreadShell(threadRef)?.projectId
          : undefined;
      const project =
        link.repositoryKey === null
          ? candidates.find((candidate) => candidate.id === threadProjectId)
          : findProjectForIssue(candidates, link);
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
