# Issues

Open **Issues** from the sidebar or the command palette to browse a project's issues without
leaving T3 Code. Pick the project at the top of the page. A project whose repository is on GitHub
shows that repository's issues, using the same GitHub account as pull requests (see
[Source control](./source-control.md#github)).

Search matches the words you type, the way the tracker searches. Filter by state, by assignee (anyone, you, or
nobody), and by label. The label menu offers the labels on issues already loaded. Lists load 50
issues at a time; **Load more issues** fetches the next page.

Select an issue to read its description, labels, assignees, state, and comments. The view is
read-only: use **Open in GitHub** or **Open in Linear** to comment, edit, or close the issue. An
issue with more than 100 comments shows the first 100 and links to the rest.

## Issues beside a thread

In a thread, open the panel's surface menu and choose **Issues** (or press I in an empty panel) to
browse the thread project's issues without leaving the conversation. Each issue you select opens
as its own tab. Links to the project's GitHub or Linear issues in chat and in pull request
descriptions open there too, including `#123` references that turn out to be issues rather than
pull requests. Outside a thread, a GitHub issue link opens the Issues page on that issue.

## Linear

Save a Linear personal API key in Settings → Integrations → Linear. The key is kept in the
environment's secret store and is never shown again. Once a key is saved, the Issues page offers
Linear beside GitHub for every project.

The first time you open Linear for a project, choose the team whose issues it shows. The choice is
saved as a project setting. Use the team menu beside the filters to switch teams, or to stop
showing Linear issues for the project. Linear does not report comment counts, so Linear rows show
none.
