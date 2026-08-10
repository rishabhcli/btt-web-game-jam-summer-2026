# verify-all evidence: 20260810T201403.217Z-db08bdbf876e

- **Outcome:** PASS
- **Producer:** `npm run verify-all`
- **Source commit:** `613b8e4937fe174957918838357c89b954eabb7b`
- **Clean at start:** yes
- **Started (UTC):** 2026-08-10T20:14:03.217Z
- **Finished (UTC):** 2026-08-10T20:17:17.242Z
- **Duration:** 194025 ms
- **Redaction class:** INTERNAL_REDACTED
- **Human redaction reviewer:** unassigned
- **Allocated ports:** 127.0.0.1:4140-4143 (reserved block 4140-4149)

## Command outcomes

| Command ID                        | Outcome | Exit | Duration (ms) |
| --------------------------------- | ------- | ---: | ------------: |
| `meta_git_commit`                 | PASS    |    0 |           413 |
| `meta_git_head_tree`              | PASS    |    0 |            85 |
| `meta_git_index_matches_head`     | PASS    |    0 |           100 |
| `meta_git_status`                 | PASS    |    0 |            74 |
| `meta_git_inputs`                 | PASS    |    0 |           100 |
| `meta_git_tag`                    | PASS    |    0 |            70 |
| `meta_npm_version`                | PASS    |    0 |           505 |
| `meta_playwright_versions`        | PASS    |    0 |          6909 |
| `check`                           | PASS    |    0 |         16785 |
| `test`                            | PASS    |    0 |         24961 |
| `build`                           | PASS    |    0 |          5773 |
| `audit`                           | PASS    |    0 |          2587 |
| `dev_preflight`                   | PASS    |    0 |          1549 |
| `dev_up`                          | PASS    |    0 |          8723 |
| `dev_health`                      | PASS    |    0 |          2381 |
| `e2e_4142_all_browsers`           | PASS    |    0 |         53489 |
| `e2e_preview_4141_chromium`       | PASS    |    0 |         36744 |
| `e2e_static_4143_chromium`        | PASS    |    0 |          7252 |
| `dev_down`                        | PASS    |    0 |          1337 |
| `meta_git_commit_end`             | PASS    |    0 |            31 |
| `meta_git_head_tree_end`          | PASS    |    0 |            47 |
| `meta_git_index_matches_head_end` | PASS    |    0 |            51 |
| `meta_git_inputs_end`             | PASS    |    0 |            47 |
| `meta_git_tag_end`                | PASS    |    0 |            47 |
| `meta_playwright_versions_end`    | PASS    |    0 |         13084 |

Skipped steps are recorded in `manifest.json`. Ordered, redacted stream events
are in `events.jsonl`. Verify the adjacent artifact digests with
`SHA256SUMS` before relying on this run.
