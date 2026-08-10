# verify-all evidence: 20260810T193017.665Z-c38656dd53c8

- **Outcome:** FAIL
- **Producer:** `npm run verify-all`
- **Source commit:** `34c11f6ea071a424cb08f71000abf065eb8d6a12`
- **Clean at start:** yes
- **Started (UTC):** 2026-08-10T19:30:17.665Z
- **Finished (UTC):** 2026-08-10T19:30:51.978Z
- **Duration:** 34313 ms
- **Redaction class:** INTERNAL_REDACTED
- **Human redaction reviewer:** unassigned
- **Allocated ports:** 127.0.0.1:4140-4143 (reserved block 4140-4149)

## Command outcomes

| Command ID                        | Outcome | Exit | Duration (ms) |
| --------------------------------- | ------- | ---: | ------------: |
| `meta_git_commit`                 | PASS    |    0 |           183 |
| `meta_git_head_tree`              | PASS    |    0 |            32 |
| `meta_git_index_matches_head`     | PASS    |    0 |            50 |
| `meta_git_status`                 | PASS    |    0 |            51 |
| `meta_git_inputs`                 | PASS    |    0 |            49 |
| `meta_git_tag`                    | PASS    |    0 |            49 |
| `meta_npm_version`                | PASS    |    0 |           215 |
| `meta_playwright_versions`        | PASS    |    0 |          2291 |
| `check`                           | PASS    |    0 |          8048 |
| `test`                            | PASS    |    0 |         11022 |
| `build`                           | PASS    |    0 |          1794 |
| `audit`                           | PASS    |    0 |           891 |
| `dev_preflight`                   | PASS    |    0 |           416 |
| `dev_up`                          | FAIL    |    0 |          3783 |
| `dev_down`                        | PASS    |    0 |           400 |
| `meta_git_commit_end`             | PASS    |    0 |            28 |
| `meta_git_head_tree_end`          | PASS    |    0 |            28 |
| `meta_git_index_matches_head_end` | PASS    |    0 |            28 |
| `meta_git_inputs_end`             | PASS    |    0 |            29 |
| `meta_git_tag_end`                | PASS    |    0 |            28 |
| `meta_playwright_versions_end`    | PASS    |    0 |          1614 |

Skipped steps are recorded in `manifest.json`. Ordered, redacted stream events
are in `events.jsonl`. Verify the adjacent artifact digests with
`SHA256SUMS` before relying on this run.
