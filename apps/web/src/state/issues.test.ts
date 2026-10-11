import type { IssueListEntry, IssueListResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeIssuePages } from "./issues";

const entry = (id: string, title = `Issue ${id}`): IssueListEntry => ({
  id,
  reference: `#${id}`,
  title,
  url: `https://github.com/acme/web/issues/${id}`,
  state: "open",
  author: null,
  labels: [],
  assignees: [],
  commentCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

const page = (entries: IssueListEntry[], nextCursor: string | null): IssueListResult => ({
  entries,
  nextCursor,
});

describe("mergeIssuePages", () => {
  it("joins pages in order and carries on from the last page's cursor", () => {
    const merged = mergeIssuePages([page([entry("3"), entry("2")], "a"), page([entry("1")], "b")]);
    expect(merged.entries.map((issue) => issue.id)).toEqual(["3", "2", "1"]);
    expect(merged.nextCursor).toBe("b");
  });

  it("keeps the first sighting of an issue a later page hands over again", () => {
    const merged = mergeIssuePages([
      page([entry("5", "first"), entry("4")], "a"),
      page([entry("5", "again"), entry("3")], null),
    ]);
    expect(merged.entries.map((issue) => [issue.id, issue.title])).toEqual([
      ["5", "first"],
      ["4", "Issue 4"],
      ["3", "Issue 3"],
    ]);
    expect(merged.nextCursor).toBeNull();
  });

  it("has nothing and no cursor before any page arrives", () => {
    expect(mergeIssuePages([])).toEqual({ entries: [], nextCursor: null });
  });
});
