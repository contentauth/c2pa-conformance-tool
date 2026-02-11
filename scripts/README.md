# Build Scripts

## generate-version.js

This script automatically generates `src/lib/version.ts` with git version information at build time.

### What it does:
- Captures the current git commit SHA (full and short)
- Records the commit date
- Records the current branch name
- Includes a timestamp of when the version file was generated

### When it runs:
- Automatically before every `npm run dev`
- Automatically before every `npm run build`

### Output:
Creates `src/lib/version.ts` with content like:

```typescript
export const VERSION_INFO = {
  "sha": "7bf7a937a6fc3b751fb693c5a64e425f8c55900d",
  "shortSha": "7bf7a93",
  "date": "2026-02-11 08:54:29 -0500",
  "branch": "main",
  "timestamp": "2026-02-11T16:49:52.969Z"
} as const
```

### Usage in code:
This version information is automatically included in all C2PA conformance reports under the `_conformanceToolVersion` field:

```typescript
import { VERSION_INFO } from './version'

// Included in every report
{
  ...manifestStore,
  _conformanceToolVersion: {
    commit: VERSION_INFO.sha,
    shortCommit: VERSION_INFO.shortSha,
    date: VERSION_INFO.date,
    branch: VERSION_INFO.branch,
    generatedAt: VERSION_INFO.timestamp
  }
}
```

### Note:
The generated `src/lib/version.ts` file is excluded from git (in .gitignore) since it's auto-generated on every build.
