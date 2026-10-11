import { describe, expect, it } from "vite-plus/test";

import { issueSourceOverrideEntry } from "./issueSource.logic";

describe("issueSourceOverrideEntry", () => {
  it("sets the team and keeps the project's other overrides", () => {
    expect(
      issueSourceOverrideEntry(
        { defaultAutoPull: true, linearTeamId: "old" },
        "linearTeamId",
        "new",
      ),
    ).toEqual({ defaultAutoPull: true, linearTeamId: "new" });
    expect(issueSourceOverrideEntry(undefined, "linearTeamId", "team-1")).toEqual({
      linearTeamId: "team-1",
    });
  });

  it("removes the choice, and the entry once nothing is left in it", () => {
    expect(
      issueSourceOverrideEntry({ defaultAutoPull: true, linearTeamId: "t" }, "linearTeamId", null),
    ).toEqual({ defaultAutoPull: true });
    expect(issueSourceOverrideEntry({ linearTeamId: "t" }, "linearTeamId", null)).toBeNull();
  });
});
