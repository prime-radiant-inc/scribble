# Scribble Internal CI Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scribble internal deployment ownership to `sen-deploy` while keeping Scribble and bot-toolkit OSS-shaped source repos with CI-only responsibilities.

**Architecture:** `scribble` and `bot-toolkit` stop dispatching or deploying into Prime Radiant infrastructure. `sen-deploy` becomes the only internal deployment owner, and Scribble deploys require explicit source SHAs for Scribble, bot-toolkit, and streamlinear until `PRI-1500` replaces the bot-toolkit tarball bridge with a published npm dependency. `sen-deploy` builds the Scribble-owned Dockerfile with BuildKit named contexts and fails early if the bot-toolkit tarball produced from `bot_toolkit_ref` does not match Scribble's lockfile integrity.

**Tech Stack:** GitHub Actions, Docker Buildx, Node.js 20, npm lockfile v3, AWS ECR/ECS via existing `sen-deploy` reusable workflows.

---

## File Structure

### `/Users/drewritter/prime-rad/sen/sen-deploy`

- Modify `.github/workflows/build-parallel.yml`: enforce the Scribble deploy contract, add explicit source SHA inputs, remove bot-toolkit-to-Scribble coupling, add the tarball-integrity preflight, and special-case the Scribble ARM Docker build to use `scribble/Dockerfile` with `build-contexts`.
- Create `scripts/check-scribble-bot-toolkit-integrity.mjs`: small Node script that compares Scribble lockfile npm SRI integrity against a freshly packed bot-toolkit tarball.
- Modify `README.md`: replace the stale source-repo-dispatch CI/CD description with the new split between OSS-source CI and internal `sen-deploy` deployment.
- Modify `CLAUDE.md`: update the build-trigger table and remove the claim that bot-toolkit pushes rebuild Scribble.
- Delete `docker/Dockerfile.scribble`: this stale Dockerfile must no longer be treated as the production Scribble build contract.

### `/Users/drewritter/prime-rad/sen/scribble`

- Delete `.github/workflows/trigger-build.yml`: Scribble must not dispatch to `sen-deploy`.
- Delete `.github/workflows/deploy.yml`: Scribble must not update ECS directly.
- Modify `AGENTS.md` and `CLAUDE.md`: update the deployment section to say Prime Radiant internal deployment is manually initiated from `sen-deploy` with explicit refs.
- Modify `README.md`: keep the Docker/self-hosted guidance, but clarify that Prime Radiant internal deployment is pull-based from `sen-deploy`.

---

## Task 1: Update `sen-deploy` Scribble Build Contract

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/sen-deploy/.github/workflows/build-parallel.yml`
- Create: `/Users/drewritter/prime-rad/sen/sen-deploy/scripts/check-scribble-bot-toolkit-integrity.mjs`
- Delete: `/Users/drewritter/prime-rad/sen/sen-deploy/docker/Dockerfile.scribble`

- [ ] **Step 1: Inspect current worktree**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
git status --short --branch
```

Expected: note any unrelated existing changes. Do not overwrite them.

- [ ] **Step 2: Add explicit Scribble source inputs**

In `.github/workflows/build-parallel.yml`, under `workflow_dispatch.inputs.repo`, keep the existing `repo` input and add these inputs:

```yaml
      scribble_ref:
        description: 'Full 40-character Scribble commit SHA. Required when repo=scribble.'
        required: false
        type: string
      bot_toolkit_ref:
        description: 'Full 40-character bot-toolkit commit SHA. Required when repo=scribble until PRI-1500.'
        required: false
        type: string
      streamlinear_ref:
        description: 'Full 40-character streamlinear commit SHA. Required when repo=scribble.'
        required: false
        type: string
```

- [ ] **Step 3: Expose the Scribble refs from the config job**

In `jobs.config.outputs`, add:

```yaml
      scribble_ref: ${{ steps.config.outputs.scribble_ref }}
      bot_toolkit_ref: ${{ steps.config.outputs.bot_toolkit_ref }}
      streamlinear_ref: ${{ steps.config.outputs.streamlinear_ref }}
```

- [ ] **Step 4: Validate explicit refs in the config shell**

In the `Determine what to build` shell block, after the existing trigger-source selection and before writing outputs, add this validation block:

```bash
          SCRIBBLE_REF="${{ inputs.scribble_ref }}"
          BOT_TOOLKIT_REF="${{ inputs.bot_toolkit_ref }}"
          STREAMLINEAR_REF="${{ inputs.streamlinear_ref }}"

          validate_sha() {
            local name="$1"
            local value="$2"
            if ! echo "$value" | grep -Eq '^[0-9a-fA-F]{40}$'; then
              echo "::error::$name must be a full 40-character commit SHA"
              exit 1
            fi
          }

          if [ "$REPO" = "scribble" ]; then
            if [ "${{ github.event_name }}" = "repository_dispatch" ]; then
              echo "::error::Scribble builds must not run from repository_dispatch. Use workflow_dispatch with explicit source SHAs."
              exit 1
            fi

            validate_sha "scribble_ref" "$SCRIBBLE_REF"
            validate_sha "bot_toolkit_ref" "$BOT_TOOLKIT_REF"
            validate_sha "streamlinear_ref" "$STREAMLINEAR_REF"

            SHA=$(echo "$SCRIBBLE_REF" | cut -c1-7)
            FULL_SHA="$SCRIBBLE_REF"
          fi

          echo "scribble_ref=$SCRIBBLE_REF" >> $GITHUB_OUTPUT
          echo "bot_toolkit_ref=$BOT_TOOLKIT_REF" >> $GITHUB_OUTPUT
          echo "streamlinear_ref=$STREAMLINEAR_REF" >> $GITHUB_OUTPUT
```

Keep the existing `repo`, `sha`, and `full_sha` output writes after this block so the possibly updated `SHA` and `FULL_SHA` values are emitted.

- [ ] **Step 5: Stop bot-toolkit from rebuilding Scribble**

In the repo-to-image case statement, replace:

```bash
            bot-toolkit)            IMAGES="pa,scribble" ;;
```

with:

```bash
            bot-toolkit)            IMAGES="pa" ;;
```

- [ ] **Step 6: Exclude stale sen-deploy Scribble Dockerfile detection**

In the `sen-deploy|*)` branch that computes `CHANGED_DOCKERFILES`, change the pipeline to exclude `scribble`:

```bash
              CHANGED_DOCKERFILES=$(curl -s -H "Authorization: Bearer ${{ github.token }}" \
                "https://api.github.com/repos/${{ github.repository }}/commits/${{ github.sha }}" \
                | jq -r '.files[].filename // empty' \
                | grep '^docker/Dockerfile\.' \
                | sed 's|docker/Dockerfile\.||' \
                | grep -v '^scribble$' \
                | tr '\n' ',' | sed 's/,$//')
```

This prevents deleting or touching `docker/Dockerfile.scribble` from creating a no-ref Scribble build.

- [ ] **Step 7: Update ARM Scribble checkouts to use explicit refs**

In the ARM job checkout steps, change the three Scribble-only refs:

```yaml
      - name: Checkout bot-toolkit
        if: matrix.image == 'scribble'
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
        with:
          repository: prime-radiant-inc/bot-toolkit
          token: ${{ steps.app-token.outputs.token }}
          ref: ${{ needs.config.outputs.bot_toolkit_ref }}
          path: bot-toolkit
          fetch-depth: 1

      - name: Checkout scribble
        if: matrix.image == 'scribble'
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
        with:
          repository: prime-radiant-inc/scribble
          token: ${{ steps.app-token.outputs.token }}
          ref: ${{ needs.config.outputs.scribble_ref }}
          path: scribble
          fetch-depth: 1

      - name: Checkout streamlinear
        if: matrix.image == 'scribble'
        uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
        with:
          repository: obra/streamlinear
          token: ${{ steps.app-token.outputs.token }}
          ref: ${{ needs.config.outputs.streamlinear_ref }}
          path: streamlinear
          fetch-depth: 1
```

- [ ] **Step 8: Create the integrity check script**

Create `scripts/check-scribble-bot-toolkit-integrity.mjs`:

```js
#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [, , lockfilePath, tarballPath] = process.argv;

if (!lockfilePath || !tarballPath) {
  console.error('Usage: node scripts/check-scribble-bot-toolkit-integrity.mjs <scribble-package-lock.json> <bot-toolkit.tgz>');
  process.exit(2);
}

const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
const entry = lockfile.packages?.['node_modules/@primeradiant/bot-toolkit'];

if (!entry?.integrity) {
  console.error('Could not find node_modules/@primeradiant/bot-toolkit integrity in Scribble package-lock.json');
  process.exit(1);
}

const expected = entry.integrity;
const tarball = readFileSync(tarballPath);
const actual = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;

if (actual !== expected) {
  console.error('bot-toolkit tarball integrity does not match Scribble package-lock.json');
  console.error(`Expected: ${expected}`);
  console.error(`Actual:   ${actual}`);
  process.exit(1);
}

console.log(`bot-toolkit tarball integrity matches Scribble lockfile: ${actual}`);
```

- [ ] **Step 9: Add the bot-toolkit preflight to the ARM workflow**

After `Login to Amazon ECR` and before Docker build steps in the ARM job, add:

```yaml
      - name: Pack bot-toolkit for Scribble integrity check
        if: matrix.image == 'scribble'
        working-directory: bot-toolkit
        run: |
          mkdir -p ../.scribble-preflight
          npm ci
          npm pack --pack-destination ../.scribble-preflight

      - name: Verify Scribble bot-toolkit tarball integrity
        if: matrix.image == 'scribble'
        run: |
          node sen-deploy/scripts/check-scribble-bot-toolkit-integrity.mjs \
            scribble/package-lock.json \
            .scribble-preflight/primeradiant-bot-toolkit-0.1.0.tgz
```

- [ ] **Step 10: Split the ARM Docker build into Scribble and non-Scribble steps**

Replace the existing ARM `Build and push ${{ matrix.image }}` step with two steps:

```yaml
      - name: Build and push scribble
        id: build-scribble
        if: matrix.image == 'scribble'
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2
        with:
          context: scribble
          file: scribble/Dockerfile
          push: true
          platforms: linux/arm64
          build-contexts: |
            bot-toolkit=bot-toolkit
            streamlinear=streamlinear
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/${{ matrix.image }}:${{ needs.config.outputs.sha }}
            ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/${{ matrix.image }}:latest
          cache-from: type=registry,ref=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/cache:${{ matrix.image }}
          cache-to: type=registry,ref=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/cache:${{ matrix.image }},mode=max

      - name: Build and push ${{ matrix.image }}
        id: build-arm-generic
        if: matrix.image != 'scribble'
        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2
        with:
          context: .
          file: sen-deploy/docker/Dockerfile.${{ matrix.image }}
          push: true
          platforms: linux/arm64
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/${{ matrix.image }}:${{ needs.config.outputs.sha }}
            ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/${{ matrix.image }}:latest
          cache-from: type=registry,ref=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/cache:${{ matrix.image }}
          cache-to: type=registry,ref=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/cache:${{ matrix.image }},mode=max
```

- [ ] **Step 11: Add a Scribble build summary in the ARM job**

After the split Docker build steps, add:

```yaml
      - name: Scribble source and image summary
        if: matrix.image == 'scribble'
        run: |
          echo "## Scribble Build Inputs" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Scribble ref:** ${{ needs.config.outputs.scribble_ref }}" >> $GITHUB_STEP_SUMMARY
          echo "**bot-toolkit ref:** ${{ needs.config.outputs.bot_toolkit_ref }}" >> $GITHUB_STEP_SUMMARY
          echo "**streamlinear ref:** ${{ needs.config.outputs.streamlinear_ref }}" >> $GITHUB_STEP_SUMMARY
          echo "**Image tag:** ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_PREFIX }}/scribble:${{ needs.config.outputs.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "**Image digest:** ${{ steps.build-scribble.outputs.digest }}" >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 12: Delete the stale sen-deploy Scribble Dockerfile**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
rm docker/Dockerfile.scribble
```

Expected: `git status --short` shows `D docker/Dockerfile.scribble`.

- [ ] **Step 13: Verify the integrity script passes with the current known-good tarball**

Run:

```bash
cd /Users/drewritter/prime-rad/sen
rm -rf /tmp/scribble-bot-toolkit-preflight
mkdir -p /tmp/scribble-bot-toolkit-preflight
cd bot-toolkit
npm pack --pack-destination /tmp/scribble-bot-toolkit-preflight
cd ../sen-deploy
node scripts/check-scribble-bot-toolkit-integrity.mjs \
  ../scribble/package-lock.json \
  /tmp/scribble-bot-toolkit-preflight/primeradiant-bot-toolkit-0.1.0.tgz
```

Expected:

```text
bot-toolkit tarball integrity matches Scribble lockfile: sha512-gScnc2jA+JvS6OciD79SmRvTonpl2qqCjlwjt8SLzwanrVFtN5G/hD/0liR20o0Ac68yk6y8fPHIRcMOnlR9og==
```

- [ ] **Step 14: Verify the integrity script fails on a bad tarball**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
printf 'not the package' > /tmp/not-bot-toolkit.tgz
if node scripts/check-scribble-bot-toolkit-integrity.mjs ../scribble/package-lock.json /tmp/not-bot-toolkit.tgz; then
  echo "ERROR: integrity check unexpectedly passed"
  exit 1
else
  echo "Integrity mismatch failed as expected"
fi
```

Expected:

```text
bot-toolkit tarball integrity does not match Scribble package-lock.json
Expected: sha512-gScnc2jA+JvS6OciD79SmRvTonpl2qqCjlwjt8SLzwanrVFtN5G/hD/0liR20o0Ac68yk6y8fPHIRcMOnlR9og==
Actual:   sha512-8m5clX6Yj+wu8tvA9nWBk0UC8Nvo22cht+xSryH5w0tvGsRPFCTDyek0lT+z3COuYpH925gQzDWWkAOj8b/AVQ==
Integrity mismatch failed as expected
```

- [ ] **Step 15: Verify the Scribble Dockerfile Buildx check uses named contexts**

Run:

```bash
cd /Users/drewritter/prime-rad/sen
docker buildx build \
  --call=check \
  --build-context bot-toolkit=bot-toolkit \
  --build-context streamlinear=../streamlinear \
  -f scribble/Dockerfile \
  scribble
```

Expected: Docker Buildx completes the check without Dockerfile parse or build-context errors.

- [ ] **Step 16: Commit sen-deploy workflow contract changes**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
git status --short
git add .github/workflows/build-parallel.yml scripts/check-scribble-bot-toolkit-integrity.mjs docker/Dockerfile.scribble
git commit -m "Update Scribble build to pull explicit source refs"
```

Expected: the commit includes only the workflow, integrity script, and stale Dockerfile deletion.

---

## Task 2: Remove Scribble-Owned Deployment Workflows

**Files:**
- Delete: `/Users/drewritter/prime-rad/sen/scribble/.github/workflows/trigger-build.yml`
- Delete: `/Users/drewritter/prime-rad/sen/scribble/.github/workflows/deploy.yml`

- [ ] **Step 1: Inspect current worktree**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
git status --short --branch
```

Expected: note the existing `PRI-1499` docs/plan changes. Do not stage unrelated files unless this execution run intentionally includes them.

- [ ] **Step 2: Delete the dispatch and deploy workflows**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
rm .github/workflows/trigger-build.yml
rm .github/workflows/deploy.yml
```

Expected: `git status --short` shows:

```text
D .github/workflows/deploy.yml
D .github/workflows/trigger-build.yml
```

- [ ] **Step 3: Verify Scribble no longer has deployment workflows**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
if rg -n "repository_dispatch|workflow_run|aws ecs update-service|sen-deploy build" .github/workflows; then
  echo "ERROR: Scribble still has deployment workflow references"
  exit 1
else
  echo "Scribble workflows no longer dispatch or deploy"
fi
```

Expected:

```text
Scribble workflows no longer dispatch or deploy
```

- [ ] **Step 4: Commit Scribble workflow cleanup**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
git status --short
git add .github/workflows/deploy.yml .github/workflows/trigger-build.yml
git commit -m "Remove Scribble-owned deployment workflows"
```

Expected: the commit includes only the two workflow deletions.

---

## Task 3: Update Deployment Documentation

**Files:**
- Modify: `/Users/drewritter/prime-rad/sen/sen-deploy/README.md`
- Modify: `/Users/drewritter/prime-rad/sen/sen-deploy/CLAUDE.md`
- Modify: `/Users/drewritter/prime-rad/sen/scribble/README.md`
- Modify: `/Users/drewritter/prime-rad/sen/scribble/AGENTS.md`
- Modify: `/Users/drewritter/prime-rad/sen/scribble/CLAUDE.md`

- [ ] **Step 1: Update `sen-deploy/CLAUDE.md` build triggers**

In `/Users/drewritter/prime-rad/sen/sen-deploy/CLAUDE.md`, replace the Build Triggers table with:

```markdown
When internal source repos push to `main`, they may trigger builds via `repository_dispatch`.
OSS-shaped repos do not dispatch production deploys into `sen-deploy`; deploys for those services are initiated from `sen-deploy` with explicit source refs.

| Source Repo | Images Rebuilt | Trigger |
|-------------|----------------|---------|
| claude-pa | pa | repository_dispatch |
| claude-pa-bot (claude-pa-matrix-bot) | pa | repository_dispatch |
| claude-pa-scheduler | pa, scheduler | repository_dispatch |
| claude-pa-dashboard | dashboard | repository_dispatch |
| claude-pa-browser | browser, pa | repository_dispatch |
| bot-toolkit | pa | repository_dispatch; does not rebuild Scribble |
| scribble | scribble | manual `sen-deploy` workflow_dispatch with explicit refs |
| spec-together | spec-together | repository_dispatch |
| sen-auth | auth | repository_dispatch |
| sen-deploy (docker/) | pa, scheduler, dashboard, init, browser | push to sen-deploy |
```

Replace the nearby warning about never manually triggering builds with:

```markdown
For Scribble, use the manual `build-parallel.yml` dispatch and provide full commit SHAs for `scribble_ref`, `bot_toolkit_ref`, and `streamlinear_ref`. Do not trigger Scribble from source-repo dispatch.
```

- [ ] **Step 2: Update `sen-deploy/README.md` CI/CD section**

In `/Users/drewritter/prime-rad/sen/sen-deploy/README.md`, replace the stale `## CI/CD` section through the `#### Concurrency Control` heading with:

````markdown
## CI/CD

Container builds are automated or manually initiated through GitHub Actions in this repository.

Internal Prime Radiant service repos may still send `repository_dispatch` events to `sen-deploy`. OSS-shaped repos such as Scribble do not own Prime Radiant deployment triggers. For Scribble, `sen-deploy` pulls explicit source commit SHAs and owns the internal ECR/ECS release.

### Trigger Sources

| Event | Trigger |
|-------|---------|
| Internal source repo push | `repository_dispatch` from that source repo |
| Scribble internal deploy | Manual `workflow_dispatch` in `build-parallel.yml` with `repo=scribble`, `scribble_ref`, `bot_toolkit_ref`, and `streamlinear_ref` |
| Push to sen-deploy `docker/**` | Direct `push` event |
| Push to sen-deploy `scripts/**` | Direct `push` event |
| Manual non-Scribble build | `workflow_dispatch` in GitHub UI |

### Scribble Internal Deploy

Scribble's source repo validates itself but does not dispatch to `sen-deploy` and does not deploy ECS directly.

To build and deploy Scribble internally during the temporary bot-toolkit tarball bridge, run:

```bash
gh workflow run build-parallel.yml \
  -R prime-radiant-inc/sen-deploy \
  -f repo=scribble \
  -f scribble_ref=<full-scribble-commit-sha> \
  -f bot_toolkit_ref=<full-bot-toolkit-commit-sha> \
  -f streamlinear_ref=<full-streamlinear-commit-sha>
```

The workflow checks out those refs, verifies the bot-toolkit tarball integrity against Scribble's lockfile, builds `scribble/Dockerfile` with BuildKit named contexts, pushes `sen/scribble:<sha>` and `sen/scribble:latest`, and deploys the `scribble` ECS service.

### Selective Image Building

The workflow determines which images to build based on what repo or manual input triggered it:

| Trigger Repo/Input | Images Built | Reason |
|--------------------|--------------|--------|
| `claude-pa` | pa | Core PA code changed |
| `claude-pa-matrix-bot` | pa | Slack adapter is bundled in PA |
| `bot-toolkit` | pa | PA consumes bot-toolkit directly; Scribble updates bot-toolkit through its own lockfile |
| `scribble` | scribble | Manual internal deploy with explicit refs |
| `sen-deploy` | pa, scheduler, dashboard, init, browser | Dockerfiles changed |

### Image Tags

Images are pushed with two tags:

- `:<sha>` - traceability tag for the triggering source SHA
- `:latest` - mutable tag currently used by ECS task definitions
````

- [ ] **Step 3: Update Scribble deployment docs in `AGENTS.md` and `CLAUDE.md`**

In both `/Users/drewritter/prime-rad/sen/scribble/AGENTS.md` and `/Users/drewritter/prime-rad/sen/scribble/CLAUDE.md`, replace the `## Deployment` section up to `## Environment Variables` with:

````markdown
## Deployment

Scribble's source repo does not deploy Prime Radiant infrastructure. It should run CI, tests, builds, and Docker smoke checks without depending on internal ECR/ECS credentials.

Prime Radiant internal deployment is owned by `sen-deploy`. To deploy Scribble internally during the temporary bot-toolkit tarball bridge, manually run `sen-deploy`'s `build-parallel.yml` workflow with explicit source commit SHAs:

```bash
gh workflow run build-parallel.yml \
  -R prime-radiant-inc/sen-deploy \
  -f repo=scribble \
  -f scribble_ref=<full-scribble-commit-sha> \
  -f bot_toolkit_ref=<full-bot-toolkit-commit-sha> \
  -f streamlinear_ref=<full-streamlinear-commit-sha>
```

`sen-deploy` checks out those refs, verifies that the bot-toolkit tarball produced from `bot_toolkit_ref` matches Scribble's lockfile integrity, builds the Scribble-owned `Dockerfile` with BuildKit named contexts, pushes the internal ECR image, and deploys ECS.

**bot-toolkit changes:** Scribble consumes the packaged `@primeradiant/bot-toolkit` through a temporary local tarball bridge until `PRI-1500`. Bot-toolkit changes should reach Scribble through an intentional Scribble dependency/lockfile update, not through a bot-toolkit-triggered Scribble deployment.

**Infrastructure changes:** The repo-local `Dockerfile` and `docker/entrypoint-scribble.sh` are the Scribble runtime contract. `sen-deploy` consumes that Dockerfile for Prime Radiant internal deployment.
````

- [ ] **Step 4: Update Scribble README production note**

In `/Users/drewritter/prime-rad/sen/scribble/README.md`, replace the `## Production Notes` paragraph with:

```markdown
## Production Notes

Prime Radiant production deploys Scribble through `sen-deploy`. This repository does not dispatch internal deployments and does not update ECS directly.

For the temporary pre-`PRI-1500` bridge, `sen-deploy` builds this repository's `Dockerfile` with BuildKit named contexts for explicit `bot-toolkit` and `streamlinear` source refs. Once `@primeradiant/bot-toolkit` is published and Scribble consumes it from npm, the bot-toolkit named context should be removed from the internal deploy path.
```

- [ ] **Step 5: Verify stale deployment docs are gone**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
if rg -n "auto-deploys|trigger-build.yml|repository_dispatch|No manual steps needed|workflow_run|aws ecs update-service" README.md AGENTS.md CLAUDE.md .github; then
  echo "ERROR: stale Scribble deployment docs remain"
  exit 1
else
  echo "Scribble docs no longer describe source-owned deployment"
fi

cd /Users/drewritter/prime-rad/sen/sen-deploy
if rg -n "bot-toolkit \\| pa, scribble|scribble \\| scribble \\| repository_dispatch|Each source repo has a `.github/workflows/trigger-build.yml`" README.md CLAUDE.md; then
  echo "ERROR: stale sen-deploy CI docs remain"
  exit 1
else
  echo "sen-deploy docs no longer describe Scribble source dispatch"
fi
```

Expected:

```text
Scribble docs no longer describe source-owned deployment
sen-deploy docs no longer describe Scribble source dispatch
```

- [ ] **Step 6: Commit documentation changes**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
git add README.md CLAUDE.md
git commit -m "Document pull-based Scribble deployment"

cd /Users/drewritter/prime-rad/sen/scribble
git add README.md AGENTS.md CLAUDE.md
git commit -m "Document Scribble deployment boundary"
```

Expected: each commit includes only docs in its repo.

---

## Task 4: End-to-End Verification and Rollout Gate

**Files:**
- Verify only unless a previous task exposed a concrete issue.

- [ ] **Step 1: Verify Scribble repo checks still pass**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
npm test
npm run build:all
```

Expected:

```text
Test Files 22 passed
Tests 253 passed
```

and `npm run build:all` exits 0 after `tsc` and `esbuild`.

- [ ] **Step 2: Verify bot-toolkit package check still passes**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/bot-toolkit
npm run check
```

Expected: `format:check`, `lint`, `typecheck`, `test`, and `pack:dry-run` all exit 0.

- [ ] **Step 3: Verify sen-deploy local checks available for this change**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/sen-deploy
git diff --check
node scripts/check-scribble-bot-toolkit-integrity.mjs \
  ../scribble/package-lock.json \
  /tmp/scribble-bot-toolkit-preflight/primeradiant-bot-toolkit-0.1.0.tgz
```

Expected: `git diff --check` exits 0 and the integrity script prints the matching SRI string.

- [ ] **Step 4: Verify Docker Buildx check before rollout**

Run:

```bash
cd /Users/drewritter/prime-rad/sen
docker buildx build \
  --call=check \
  --build-context bot-toolkit=bot-toolkit \
  --build-context streamlinear=../streamlinear \
  -f scribble/Dockerfile \
  scribble
```

Expected: Docker Buildx exits 0.

- [ ] **Step 5: Trigger a sen-deploy Scribble build only after branch review**

After the implementation branch is reviewed and ready for a real CI check, collect full commit SHAs:

```bash
SCRIBBLE_SHA=$(cd /Users/drewritter/prime-rad/sen/scribble && git rev-parse HEAD)
BOT_TOOLKIT_SHA=$(cd /Users/drewritter/prime-rad/sen/bot-toolkit && git rev-parse HEAD)
STREAMLINEAR_SHA=$(cd /Users/drewritter/prime-rad/streamlinear && git rev-parse HEAD)

printf 'scribble=%s\nbot-toolkit=%s\nstreamlinear=%s\n' \
  "$SCRIBBLE_SHA" "$BOT_TOOLKIT_SHA" "$STREAMLINEAR_SHA"
```

Then trigger:

```bash
gh workflow run build-parallel.yml \
  -R prime-radiant-inc/sen-deploy \
  -f repo=scribble \
  -f scribble_ref="$SCRIBBLE_SHA" \
  -f bot_toolkit_ref="$BOT_TOOLKIT_SHA" \
  -f streamlinear_ref="$STREAMLINEAR_SHA"
```

Expected: GitHub Actions accepts the workflow dispatch.

- [ ] **Step 6: Watch the workflow and inspect the summary**

Run:

```bash
gh run list -R prime-radiant-inc/sen-deploy --workflow 'Build (Parallel)' --limit 5
gh run watch -R prime-radiant-inc/sen-deploy
```

Expected:

- Build matrix includes `scribble` in ARM only.
- The bot-toolkit integrity preflight passes before Docker build.
- The Scribble Docker build uses `scribble/Dockerfile`.
- The workflow summary records `scribble_ref`, `bot_toolkit_ref`, `streamlinear_ref`, image tag, and image digest.
- `deploy-scribble` runs only after the ARM build succeeds.

- [ ] **Step 7: Verify no source-owned dispatch remains**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
if rg -n "repository_dispatch|workflow_run|peter-evans/repository-dispatch|aws-actions/configure-aws-credentials|aws ecs update-service" .github README.md AGENTS.md CLAUDE.md; then
  echo "ERROR: source-owned deployment reference remains"
  exit 1
else
  echo "No Scribble source-owned deployment references remain"
fi

cd /Users/drewritter/prime-rad/sen/sen-deploy
if rg -n "bot-toolkit\\) +IMAGES=\"pa,scribble\"|docker/Dockerfile.scribble|ref: \\$\\{\\{ needs.config.outputs.repo == 'bot-toolkit' && needs.config.outputs.full_sha \\|\\| '' \\}\\}" .github/workflows/build-parallel.yml docker README.md CLAUDE.md; then
  echo "ERROR: stale sen-deploy Scribble build reference remains"
  exit 1
else
  echo "No stale sen-deploy Scribble build references remain"
fi
```

Expected:

```text
No Scribble source-owned deployment references remain
No stale sen-deploy Scribble build references remain
```

- [ ] **Step 8: Move `PRI-1499` back to In Review with implementation reflection**

After all verification passes, move `PRI-1499` to In Review and add a Linear comment covering:

- What went smoothly: separating source CI from internal deploy ownership.
- What was tricky: the temporary bot-toolkit tarball bridge and mutable `latest` behavior.
- Risk flags: `PRI-1500` must remove `bot_toolkit_ref` and the `bot-toolkit` named context after npm publish.

- [ ] **Step 9: Final commit or PR handoff**

If the work was done on direct `main`, do not create a new branch. If the work was done on a feature branch, push it and open the PR using the repo's normal workflow. Include the verification evidence from Steps 1-7 in the PR or handoff note.
