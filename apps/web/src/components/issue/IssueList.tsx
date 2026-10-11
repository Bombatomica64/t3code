import type { IssueListEntry } from "@t3tools/contracts";
import { ChevronDownIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
  PullRequestMetaLine,
} from "../pullRequest/pullRequestPresentation";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { issueStatePresentation } from "./issueTrackers";

export function IssueStateGlyph({
  issue,
  className,
}: {
  issue: Pick<IssueListEntry, "state" | "statusName"> & {
    readonly stateReason?: Parameters<typeof issueStatePresentation>[0]["stateReason"];
  };
  className?: string;
}) {
  const presentation = issueStatePresentation(issue);
  const label = issue.statusName ?? presentation.label;
  return (
    <Tooltip>
      {/* The row is a button, so the trigger stays a span rather than nesting a control. */}
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <presentation.Icon
          role="img"
          aria-label={label}
          className={cn("size-4 shrink-0", presentation.toneClassName, className)}
        />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Labels past this many are counted on the last chip rather than drawn. */
const ROW_LABEL_LIMIT = 3;

export function IssueListRow({
  issue,
  selected,
  onSelect,
}: {
  issue: IssueListEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const shown = issue.labels.slice(0, ROW_LABEL_LIMIT);
  const hidden = issue.labels.length - shown.length;
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        PULL_REQUEST_ROW_CLASS,
        "px-3 py-2 hover:bg-accent/60",
        selected && "bg-accent hover:bg-accent",
      )}
    >
      <span className="flex w-4 shrink-0 flex-col items-center self-start pt-0.5">
        <IssueStateGlyph issue={issue} />
      </span>
      <PullRequestRowLines
        number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>{issue.reference}</span>}
        title={issue.title}
        status={
          issue.commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 tabular-nums text-muted-foreground">
              <MessageSquareIcon aria-hidden className="size-3" />
              {issue.commentCount}
              <span className="sr-only"> comments</span>
            </span>
          ) : null
        }
        meta={
          <PullRequestMetaLine>
            {issue.author ? (
              <span key="author" className="flex min-w-0 items-center gap-1">
                <PullRequestActorAvatar actor={issue.author} className="size-3.5" />
                <span className="truncate">{issue.author.login}</span>
              </span>
            ) : null}
            {issue.statusName ? <span key="status">{issue.statusName}</span> : null}
            {shown.length > 0 ? (
              <span key="labels" className="flex min-w-0 items-center gap-1">
                {shown.map((label, index) => (
                  <PullRequestLabelChip key={label.name} label={label}>
                    {index === shown.length - 1 && hidden > 0 ? ` +${hidden}` : null}
                  </PullRequestLabelChip>
                ))}
              </span>
            ) : null}
            {issue.assignees.length > 0 ? (
              <span key="assignees" className="flex shrink-0 -space-x-1">
                {issue.assignees.slice(0, 3).map((assignee) => (
                  <PullRequestActorAvatar
                    key={assignee.login}
                    actor={assignee}
                    className="size-3.5 ring-1 ring-background"
                  />
                ))}
              </span>
            ) : null}
          </PullRequestMetaLine>
        }
        updatedAt={issue.updatedAt}
      />
    </button>
  );
}

export interface IssueFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/** One narrowing as a quiet menu button showing its current choice. */
export function IssueFilterMenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<IssueFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${label}: ${current.label}`}
        render={<Button variant="ghost-muted" size="sm" />}
        className="min-w-0"
      >
        <span className="truncate">{current.label}</span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The search box. It reports every keystroke; the page debounces before asking the tracker, and
 * shows `busy` while that answer is on its way.
 */
export function IssueSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onChange(event.currentTarget.value);
        }}
        placeholder="Search issues"
        aria-label="Search issues"
      />
    </InputGroup>
  );
}
