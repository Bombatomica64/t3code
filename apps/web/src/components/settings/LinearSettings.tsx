import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";

const NEW_KEY_URL = "https://linear.app/settings/account/security";

/**
 * The Linear API key the Issues page reads with, kept in the server's secret store. Write-only:
 * the saved key is never shown, only whether one is set.
 */
function LinearApiKeyForm({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const isSaved =
    useEnvironmentSettings(environmentId, (settings) => settings.linearApiKey).length > 0;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save the Linear API key",
  });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (apiKey: string) => {
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { linearApiKey: apiKey } },
      });
      if (result._tag === "Success") setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) void save(draft.trim());
      }}
    >
      {/* Locked while saving: a successful save clears the draft, which would drop edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <Input
          aria-label="Linear API key"
          type="password"
          autoComplete="off"
          size="sm"
          className="min-w-48 flex-1"
          placeholder={isSaved ? "Stored secret, enter a new value to replace" : "Not set"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {isSaved ? (
          <Button size="sm" variant="outline" onClick={() => void save("")}>
            Remove
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Save
        </Button>
      </fieldset>
    </form>
  );
}

export function LinearIntegrationSettings() {
  const { environment: selected } = useSettingsScope();
  const connected = selected?.connection.phase === "connected" && selected.serverConfig !== null;
  return (
    <SettingsSection id="linear" title="Linear">
      <SettingsRow
        {...searchableSetting("linear-api-key")}
        serverScoped
        settingKeys={["linearApiKey"]}
        description={
          <>
            Lets the Issues page read your Linear teams. Each project picks its team on the Issues
            page. Create a personal API key in Linear's security settings.{" "}
            <InlineButton
              render={<a href={NEW_KEY_URL} target="_blank" rel="noreferrer noopener" />}
            >
              Create a key
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          </>
        }
      >
        {connected ? (
          <LinearApiKeyForm key={selected.environmentId} environmentId={selected.environmentId} />
        ) : (
          <p className="text-xs text-muted-foreground">Connect an environment to save a key.</p>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
