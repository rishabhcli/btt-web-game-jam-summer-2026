# verify-all evidence: 20260810T192538.286Z-0f315ef731c5

- **Outcome:** FAIL
- **Producer:** `npm run verify-all`
- **Source commit:** `20c2e7d02286b4ef65c0f8c67fd7f218b8bcdd2b`
- **Clean at start:** no
- **Started (UTC):** 2026-08-10T19:25:38.286Z
- **Finished (UTC):** 2026-08-10T19:26:00.919Z
- **Duration:** 22633 ms
- **Redaction class:** INTERNAL_REDACTED
- **Human redaction reviewer:** unassigned
- **Allocated ports:** 127.0.0.1:4140-4143 (reserved block 4140-4149)

## Command outcomes

| Command ID                        | Outcome | Exit | Duration (ms) |
| --------------------------------- | ------- | ---: | ------------: |
| `meta_git_commit`                 | PASS    |    0 |           142 |
| `meta_git_head_tree`              | PASS    |    0 |            24 |
| `meta_git_index_matches_head`     | PASS    |    0 |            22 |
| `meta_git_status`                 | PASS    |    0 |            26 |
| `meta_git_inputs`                 | PASS    |    0 |            24 |
| `meta_git_tag`                    | PASS    |    0 |            27 |
| `meta_npm_version`                | PASS    |    0 |           128 |
| `meta_playwright_versions`        | PASS    |    0 |          3238 |
| `check`                           | PASS    |    0 |          5040 |
| `test`                            | PASS    |    0 |          6311 |
| `build`                           | PASS    |    0 |          1324 |
| `audit`                           | PASS    |    0 |           915 |
| `meta_git_commit_end`             | PASS    |    0 |            23 |
| `meta_git_head_tree_end`          | PASS    |    0 |            23 |
| `meta_git_index_matches_head_end` | PASS    |    0 |            23 |
| `meta_git_inputs_end`             | PASS    |    0 |            24 |
| `meta_git_tag_end`                | PASS    |    0 |            22 |
| `meta_playwright_versions_end`    | PASS    |    0 |          2931 |

Skipped steps are recorded in `manifest.json`. Ordered, redacted stream events
are in `events.jsonl`. Verify the adjacent artifact digests with
`SHA256SUMS` before relying on this run.
