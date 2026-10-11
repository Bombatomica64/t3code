import type { IssueStateReason, IssueTrackerKind } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";
import type { ElementType } from "react";

import { GitHubIcon, LinearIcon } from "../Icons";

export interface IssueTrackerPresentation {
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
  /**
   * For a tracker the page has to tell where a project's issues live: the project setting that
   * holds the choice, and what one choice is called.
   */
  readonly source?: { readonly settingKey: "linearTeamId"; readonly noun: string };
}

export const ISSUE_TRACKERS: Record<IssueTrackerKind, IssueTrackerPresentation> = {
  github: { label: "GitHub", Icon: GitHubIcon },
  linear: {
    label: "Linear",
    Icon: LinearIcon,
    source: { settingKey: "linearTeamId", noun: "team" },
  },
};

/** An issue's state as one glyph, in the tones pull requests use for open and merged. */
export function issueStatePresentation(input: {
  readonly state: "open" | "closed";
  readonly stateReason?: IssueStateReason | null | undefined;
}) {
  if (input.state === "open") {
    return {
      label: "Open",
      Icon: CircleDotIcon,
      toneClassName: "text-emerald-600 dark:text-emerald-300/90",
    };
  }
  if (input.stateReason === "not-planned" || input.stateReason === "duplicate") {
    return {
      label: input.stateReason === "duplicate" ? "Closed as duplicate" : "Closed as not planned",
      Icon: CircleSlashIcon,
      toneClassName: "text-zinc-500 dark:text-zinc-400/80",
    };
  }
  return {
    label: "Closed",
    Icon: CircleCheckIcon,
    toneClassName: "text-violet-600 dark:text-violet-300/90",
  };
}
