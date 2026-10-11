import type { EnvironmentId, IssueTrackerKind, ProjectId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { issueSourceOverrideEntry } from "./issueSource.logic";
import { ISSUE_TRACKERS } from "./issueTrackers";

interface IssueSourceTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly tracker: IssueTrackerKind;
}

/**
 * Saves where a project's issues live on a tracker as the project's own setting, the way a project
 * override saved from Settings is: the project's whole override entry, with this one key changed.
 * `null` removes the project's choice, so it inherits the environment's again.
 */
function useSaveIssueSource({ environmentId, projectId, tracker }: IssueSourceTarget) {
  const settingKey = ISSUE_TRACKERS[tracker].source?.settingKey;
  const overrides = useEnvironmentSettings(
    environmentId,
    (settings) => settings.projectSettingsOverrides,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `save the ${ISSUE_TRACKERS[tracker].label} ${ISSUE_TRACKERS[tracker].source?.noun ?? "source"}`,
  });
  return useCallback(
    async (value: string | null) => {
      if (settingKey === undefined) return false;
      const result = await updateSettings({
        environmentId,
        input: {
          patch: {
            projectSettingsOverrides: {
              [projectId]: issueSourceOverrideEntry(overrides[projectId], settingKey, value),
            },
          },
        },
      });
      return result._tag === "Success";
    },
    [environmentId, overrides, projectId, settingKey, updateSettings],
  );
}

function useSourceOptions(target: IssueSourceTarget, enabled: boolean) {
  return useEnvironmentQuery(
    enabled
      ? issueEnvironment.sourceOptions({
          environmentId: target.environmentId,
          input: { projectId: target.projectId, tracker: target.tracker },
        })
      : null,
  );
}

/** Asked in place of a list, for a tracker that has to be told where this project's issues live. */
export function IssueSourcePicker({
  detail,
  onChanged,
  ...target
}: IssueSourceTarget & { readonly detail: string | null; readonly onChanged: () => void }) {
  const presentation = ISSUE_TRACKERS[target.tracker];
  const noun = presentation.source?.noun ?? "source";
  const options = useSourceOptions(target, true);
  const save = useSaveIssueSource(target);
  const [saving, setSaving] = useState(false);
  const choose = async (id: string) => {
    setSaving(true);
    try {
      if (await save(id)) onChanged();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          Choose the {presentation.label} {noun} for this project
        </EmptyTitle>
        <EmptyDescription>
          {detail ?? `Issues are read from the ${noun} you choose.`} You can change it later here.
        </EmptyDescription>
      </EmptyHeader>
      {options.data === null ? (
        options.error !== null ? (
          <>
            <p className="text-xs text-destructive">{options.error}</p>
            <Button size="sm" variant="outline" onClick={options.refresh}>
              Retry
            </Button>
          </>
        ) : (
          <Spinner />
        )
      ) : options.data.options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The {presentation.label} account has no {noun}s to choose from.
        </p>
      ) : (
        <Menu>
          <MenuTrigger
            render={<Button size="sm" variant="outline" disabled={saving} />}
            aria-label={`Choose a ${noun}`}
          >
            {saving ? <Spinner aria-hidden /> : null}
            Choose a {noun}
            <ChevronDownIcon aria-hidden className="size-3" />
          </MenuTrigger>
          <MenuPopup align="center" side="bottom">
            {options.data.options.map((option) => (
              <MenuItem key={option.id} onClick={() => void choose(option.id)}>
                {option.name}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
    </Empty>
  );
}

/**
 * The current source as a quiet menu beside the filters, to move the project to another one or
 * stop reading this tracker for it.
 */
export function IssueSourceMenu({
  name,
  onChanged,
  ...target
}: IssueSourceTarget & { readonly name: string | null; readonly onChanged: () => void }) {
  const presentation = ISSUE_TRACKERS[target.tracker];
  const noun = presentation.source?.noun ?? "source";
  const [open, setOpen] = useState(false);
  const options = useSourceOptions(target, open);
  const save = useSaveIssueSource(target);
  const choose = async (id: string | null) => {
    if (await save(id)) onChanged();
  };
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        aria-label={`${presentation.label} ${noun}: ${name ?? "unknown"}`}
        render={<Button variant="ghost-muted" size="sm" />}
        className="min-w-0"
      >
        <span className="truncate">{name ?? `Choose a ${noun}`}</span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        {options.data === null ? (
          <div className="flex justify-center p-2">
            {options.error !== null ? (
              <span className="text-xs text-destructive">{options.error}</span>
            ) : (
              <Spinner />
            )}
          </div>
        ) : (
          options.data.options.map((option) => (
            <MenuItem key={option.id} onClick={() => void choose(option.id)}>
              {option.name}
            </MenuItem>
          ))
        )}
        <MenuSeparator />
        <MenuItem onClick={() => void choose(null)}>
          Stop showing {presentation.label} issues here
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
