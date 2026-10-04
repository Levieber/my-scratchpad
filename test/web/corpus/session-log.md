Session log, written by an agent through `POST /append`.

2026-09-30 10:12 — started on the migration
2026-09-30 10:40 — **blocked**: the export fixture is missing a field
2026-09-30 11:05 — fixed; see <https://github.com/example/repo/pull/12>

| step     | status | notes          |
| -------- | :----: | -------------- |
| migrate  |   ✅   | 0003 applied   |
| backfill |   ⏳   | ~40% (est. 2h) |
| verify   |        | after backfill |

- [ ] Re-run backfill on staging
- [x] Notify the channel

Raw HTML stays text: <script>alert("x")</script> <img src=x onerror=alert(1)>
A [bad link](<javascript:alert(1)>) and a [[wiki link]] and {{pad:unknown}}.
