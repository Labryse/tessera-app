# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Tessera has applied to the SignPath Foundation's open source programme. Until the application is accepted, the Windows installers are not Authenticode-signed. Update files are always signed with Tessera's own updater key, and the app refuses an update whose signature does not match.

## Team roles

- Committers and reviewers: [Labryse](https://github.com/Labryse)
- Approvers: [Labryse](https://github.com/Labryse)

Tessera is maintained by one person. Changes from anyone else arrive as pull requests and are reviewed before they are merged. Everyone with access to the repository or to SignPath uses multi-factor authentication.

## How a release is built and signed

1. The Release workflow (`.github/workflows/release.yml`) builds Tessera on a GitHub-hosted runner from a commit on `main` of this repository. Nothing is built or signed on a personal computer.
2. The workflow sends the unsigned installer to SignPath.
3. The approver checks that the request comes from the expected commit and workflow run, and approves each signing request by hand.
4. The signed installer and its update signature go to a draft GitHub release, which the maintainer publishes.

Only files built from this repository's source are signed with this certificate.

## Privacy

See the [privacy policy](PRIVACY.md) for every connection Tessera makes and what it sends.
