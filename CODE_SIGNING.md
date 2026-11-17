# Code signing policy

The Windows installers are not Authenticode-signed yet, so Windows may warn that the publisher is unknown. When Tessera gets a code signing certificate, this page will name who provides it and how each signature is approved.

Update files are always signed with Tessera's own updater key, and the app refuses an update whose signature does not match.

## Team roles

- Committers and reviewers: [Labryse](https://github.com/Labryse)
- Release approvers: [Labryse](https://github.com/Labryse)

Tessera is maintained by one person. Changes from anyone else arrive as pull requests and are reviewed before they are merged. Everyone with access to the repository uses multi-factor authentication.

## How a release is built

1. The Release workflow (`.github/workflows/release.yml`) builds Tessera on a GitHub-hosted runner from a commit on `main` of this repository. Nothing is built on a personal computer.
2. The workflow signs the update file with the updater key, which is kept as a repository secret.
3. The installer and its update signature go to a draft GitHub release, which the maintainer checks and publishes.

## Privacy

See the [privacy policy](PRIVACY.md) for every connection Tessera makes and what it sends.
