import type { IssueStateReason, IssueTrackerKind } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";
import type { ElementType } from "react";

import { GitHubIcon } from "../Icons";

export interface IssueTrackerPresentation {
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
}

export const ISSUE_TRACKERS: Record<IssueTrackerKind, IssueTrackerPresentation> = {
  github: { label: "GitHub", Icon: GitHubIcon },
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
