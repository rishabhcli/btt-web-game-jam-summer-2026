# verify-all evidence: 20260810T152632.603Z-2b1f1df77a07

- **Outcome:** FAIL
- **Producer:** `npm run verify-all`
- **Source commit:** `a1ae0d6a92f73d07bf0155024677d944c79886b2`
- **Clean at start:** yes
- **Started (UTC):** 2026-08-10T15:26:32.603Z
- **Finished (UTC):** 2026-08-10T15:26:56.027Z
- **Duration:** 23424 ms
- **Redaction class:** INTERNAL_REDACTED
- **Human redaction reviewer:** unassigned
- **Allocated ports:** 127.0.0.1:4140-4143 (reserved block 4140-4149)

## Command outcomes

| Command ID                        | Outcome | Exit | Duration (ms) |
| --------------------------------- | ------- | ---: | ------------: |
| `meta_git_commit`                 | PASS    |    0 |           178 |
| `meta_git_head_tree`              | PASS    |    0 |            33 |
| `meta_git_index_matches_head`     | PASS    |    0 |            31 |
| `meta_git_status`                 | PASS    |    0 |            50 |
| `meta_git_inputs`                 | PASS    |    0 |            47 |
| `meta_git_tag`                    | PASS    |    0 |            48 |
| `meta_npm_version`                | PASS    |    0 |           155 |
| `meta_playwright_versions`        | PASS    |    0 |          2355 |
| `check`                           | FAIL    |    1 |          3621 |
| `test`                            | PASS    |    0 |          6900 |
| `build`                           | PASS    |    0 |          1870 |
| `audit`                           | PASS    |    0 |           926 |
| `meta_git_commit_end`             | PASS    |    0 |            46 |
| `meta_git_head_tree_end`          | PASS    |    0 |            27 |
| `meta_git_index_matches_head_end` | PASS    |    0 |            51 |
| `meta_git_inputs_end`             | PASS    |    0 |            34 |
| `meta_git_tag_end`                | PASS    |    0 |            52 |
| `meta_playwright_versions_end`    | PASS    |    0 |          2618 |

Skipped steps are recorded in `manifest.json`. Ordered, redacted stream events
are in `events.jsonl`. Verify the adjacent artifact digests with
`SHA256SUMS` before relying on this run.
