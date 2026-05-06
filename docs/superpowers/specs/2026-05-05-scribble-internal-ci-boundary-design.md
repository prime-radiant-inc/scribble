# Scribble Internal CI Boundary Design

## Status

Approved direction. Design note only; no implementation in this file.

## Context

Scribble is being prepared for external OSS/self-hosted use while Prime Radiant still needs to deploy it through the internal `sen-deploy` ECS/ECR pipeline.

The current deployment shape mixes those concerns:

- Scribble has a `trigger-build.yml` workflow that dispatches to `sen-deploy`.
- Scribble also has a stale deploy workflow that waits on `sen-deploy` and then updates ECS directly.
- `sen-deploy` still builds Scribble with its own `docker/Dockerfile.scribble`, but the Scribble repo now owns a repo-local Dockerfile that mirrors the intended runtime.
- `sen-deploy` maps `repo=bot-toolkit` to `pa,scribble`, which makes bot-toolkit pushes a Scribble deployment trigger.

That coupling is a poor fit for OSS-shaped repositories. Public source repos should be able to run CI without knowing about Prime Radiant's private deploy system.

## Decision

Use a pull-based internal deployment model with explicit source refs.

Scribble and bot-toolkit should validate themselves, but should not dispatch to `sen-deploy` and should not know about internal ECS/ECR deployment details.

`sen-deploy` owns internal deployment. When Prime Radiant wants to deploy Scribble, `sen-deploy` checks out explicit source refs, builds the Scribble-owned Dockerfile with the needed named contexts, pushes the internal ECR image, and deploys ECS.

It is not enough for `sen-deploy` to pull from default branches. Scribble deploys must be reproducible from the source refs supplied to the deploy workflow.

## Desired Flow

1. `bot-toolkit` CI proves the package builds, tests, and packs.
2. `scribble` CI proves Scribble tests, builds, and optionally Docker-builds with local contexts.
3. `sen-deploy` is manually triggered, or triggered only from internal `sen-deploy` changes, with explicit refs for the source inputs.
4. `sen-deploy` checks out Scribble, bot-toolkit, and streamlinear at those refs.
5. During the temporary bot-toolkit tarball bridge, `sen-deploy` verifies the bot-toolkit tarball produced from `bot_toolkit_ref` matches Scribble's lockfile integrity.
6. `sen-deploy` builds `scribble/Dockerfile` using BuildKit named contexts:
   - `bot-toolkit=bot-toolkit`
   - `streamlinear=streamlinear`
7. `sen-deploy` pushes `sen/scribble` and deploys the `scribble` ECS service.
8. The workflow summary records the input refs, image tags, and image digest.

## Implementation Shape

In `sen-deploy`:

- Special-case the ARM Scribble build to use `context: scribble` and `file: scribble/Dockerfile`.
- Pass BuildKit named contexts for `bot-toolkit` and `streamlinear`.
- Keep the existing `sen-deploy/docker/Dockerfile.<image>` path for other ARM images such as `spec-together` and `session-explorer`.
- Remove `scribble` from the `repo=bot-toolkit` image mapping.
- Add required Scribble deploy inputs for `scribble_ref`, `bot_toolkit_ref`, and `streamlinear_ref` while the tarball bridge exists.
- Use those refs for the Scribble, bot-toolkit, and streamlinear checkouts instead of falling back to each repo's default branch.
- Add a preflight that packs bot-toolkit from `bot_toolkit_ref`, computes the tarball's npm SRI integrity string, and compares it to the `node_modules/@primeradiant/bot-toolkit` integrity in Scribble's lockfile.
- Fail before Docker build if the tarball integrity does not match.
- Keep current mutable-`latest` ECS deployment behavior for this slice, but report the pushed image digest and SHA tag in the workflow summary.

In `scribble`:

- Remove or disable `trigger-build.yml`.
- Remove or disable the stale direct ECS deploy workflow.
- Keep CI focused on tests, build, package/runtime checks, and optional Docker build smoke.

In `bot-toolkit`:

- Do not add a `sen-deploy` dispatch workflow.
- Keep CI focused on public package quality gates.

## Temporary Bot-Toolkit Bridge

Until `PRI-1500` publishes `@primeradiant/bot-toolkit` and Scribble consumes it as a normal npm dependency, Scribble depends on a packed bot-toolkit tarball path in `package-lock.json`.

Because `npm ci` enforces lockfile integrity, arbitrary bot-toolkit HEAD should not implicitly deploy Scribble. Bot-toolkit changes should reach Scribble through an intentional Scribble dependency update, lockfile refresh, and Scribble CI run.

After `PRI-1500`, `sen-deploy` should no longer need a bot-toolkit checkout for Scribble. Scribble's lockfile will pin the published npm package version.

## Image Tagging

The current ECS task definition points Scribble at the mutable image tag configured by `image_tag`, which defaults to `latest`.

This design does not change that behavior. The CI workflow may also push a source-SHA tag, but the deployed task definition still resolves through the existing mutable tag unless a future release slice moves Scribble to immutable task-definition revisions.

For this slice, traceability comes from the `sen-deploy` workflow summary: source refs, pushed tags, and the resulting image digest.

## Non-Goals

- Do not add a bot-toolkit-to-sen-deploy dispatch workflow.
- Do not make OSS repositories depend on internal Prime Radiant secrets, app tokens, ECR, ECS, or Terraform.
- Do not keep two competing Scribble deploy paths.
- Do not redesign the broader sen-deploy image pipeline.
- Do not switch Scribble ECS deployment to immutable image tags in this slice.
- Do not publish bot-toolkit as part of this change; that remains `PRI-1500`.

## Acceptance Criteria

- Scribble source repo CI can run without internal deploy credentials.
- Bot-toolkit source repo CI can run without internal deploy credentials.
- Internal Scribble deployment is initiated and owned by `sen-deploy`.
- `sen-deploy` does not deploy Scribble from `repository_dispatch`; Scribble deploys only from `workflow_dispatch` or an explicitly intended internal `sen-deploy` trigger that supplies source refs.
- Scribble deploys in `sen-deploy` require explicit source refs during the temporary bot-toolkit tarball bridge.
- `sen-deploy` fails early when `bot_toolkit_ref` produces a tarball that does not match Scribble's lockfile integrity.
- `sen-deploy` builds Scribble from the Scribble-owned Dockerfile.
- The Scribble ARM Docker build uses the Docker action's `build-contexts` input and is verified by a no-push Docker build or Buildx check before rollout.
- A bot-toolkit push does not by itself rebuild or deploy Scribble.
- The temporary bot-toolkit tarball bridge remains explicit and does not create surprise downstream deploys.
- After `PRI-1500`, Scribble deploys no longer require `bot_toolkit_ref`, no longer pass a `bot-toolkit` named context, and Scribble's lockfile resolves `@primeradiant/bot-toolkit` from npm with registry integrity.
- Workflow output records the source refs and pushed image digest.
- `sen-deploy` and Scribble docs no longer describe source-repo dispatch or Scribble-owned ECS deployment as the current deployment path.
