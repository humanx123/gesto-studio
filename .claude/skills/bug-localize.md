---
name: bug-localize
description: Systematically localize, diagnose, and fix bugs in the combined-app project (Vibe DAW + Gesture Synth). Use when debugging errors, test failures, or runtime issues.
---

# Bug Localization Skill

When the user reports a bug or test failure, follow this systematic approach:

## Phase 1: Reproduce and Isolate

1. **Reproduce the error** — Run the failing test or action to confirm the issue
2. **Identify the scope** — Which package? gesture-synth/ or vibe-daw/?
3. **Check recent changes** — `git log --oneline -20` for the relevant package
4. **Read the error message** — Always start with the first error, not the last

## Phase 2: Diagnose Root Cause

### For Test Failures

```bash
# Run specific test file
npx vitest run src/path/to/test.ts

# Watch mode for iterative debugging
npx vitest watch src/path/to/test.ts
```

### For Runtime Errors

1. Check the browser console or terminal output
2. Look for stack traces pointing to specific files
3. Check `src/` imports — especially `@gesto/*` alias resolution

### For Build Errors

```bash
# Type check
npm run typecheck

# Build
npm run build
```

## Phase 3: Fix and Verify

1. **Fix the root cause** — Not a workaround; address the origin
2. **Run affected tests** — Run the full test suite for that package
3. **Verify no regressions** — All 318 Vibe tests + 37 Gesture tests should pass
4. **Check the build** — `npm run build` should succeed

## Common Bug Patterns in This Project

### @gesto Import Resolution
- `@gesto/chords`, `@gesto/handTracker`, `@gesto/chordReader` resolve to gesture-synth/src/
- Vite config: `resolve.alias` points to `../gesture-synth/src`
- Tests may fail if gesture-synth isn't built first

### Free Model (Pollinations) Issues
- Model returns MALFORMED function calls — check `parseToolArgs` in `llm.ts`
- 402 rate limit after free quota — check retry logic with `retryAfter`
- MAX_TOKENS finish (1500 token cap) — treated as STOP, not error

### Live Band Timing
- `scheduleOnce` prevents duplicate live events on loops
- Live clip bounds include current bar: `takeBounds(live)`
- Bass latency: check `horizon = guard + 1.5 ticks`

### Thinking Level Fallback
- Gemini MINIMAL refused → fallback to LOW → then no thinking
- Remembered per model: `thinkingFallback Map`

## After Fixing

1. Commit with descriptive message explaining the bug and fix
2. Push changes
3. Deploy to Cloudflare Pages: `./deploy.sh`
4. Test on a real device if possible (Android APK)
