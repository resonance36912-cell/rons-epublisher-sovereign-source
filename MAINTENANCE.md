# ePublisher maintenance

This repository is the GitHub source-history authority for the RONSAS ePublisher spoke.

- Production URL: https://epublisher.reson8.life
- Ealiophin loopback port: 3101
- Control repository: https://github.com/resonance36912-cell/RONSAS
- Promotion model: review branch -> CI -> merge -> validated local build -> governed production promotion

## Source boundaries

Commit application source, tests, portable scripts, configuration templates, and maintenance documentation.

Do not commit `.env` files, credentials, private keys, runtime databases, `node_modules`, build output, logs, caches, model blobs, machine-local state, or rollback snapshots.

## Routine maintenance

1. Start from a clean `main` synchronized with GitHub.
2. Create a focused branch under `ronsas/`.
3. Run the repository CI commands locally before opening a pull request.
4. Merge only after CI passes.
5. Build on Ealiophin and smoke-test the loopback service before public promotion.
6. Record promoted source-authority/topology changes in the RONSAS control repository.

## Scaling rule

Scale by adding tests, workflows, modules, and services behind stable interfaces. Do not duplicate mutable runtime state into Git and do not make one app repository the authority for another app.
