# Releasing driftcheck

driftcheck uses Release Please, GitHub Releases, and npm trusted publishing.

## One-time bootstrap

Trusted publishing can only be configured after the npm package exists. Do this manually once:

1. Sign in locally with `npm login`.
2. Verify the package name is available and the release contents are correct:

   ```bash
   npm pack --dry-run
   ```

3. Publish the first version locally:

   ```bash
   npm publish --access public
   ```

4. On npmjs.com, open the `driftcheck` package settings and configure a Trusted Publisher with the exact, case-sensitive values:
   - Provider: GitHub Actions
   - GitHub owner/user: `sxuff`
   - Repository: `driftcheck`
   - Workflow filename: `publish.yml`
   - Environment: leave empty unless the workflow is updated to use one

5. Add a GitHub repository secret named `RELEASE_PLEASE_TOKEN`. Use a fine-grained personal access token that can create pull requests, tags, and releases. A non-default token is required because events created by the default `GITHUB_TOKEN` do not trigger the separate `release: published` publish workflow.

Do not add `NODE_AUTH_TOKEN` to the trusted-publishing workflow. npm obtains short-lived credentials through OIDC, and provenance is generated automatically.

## Normal release flow

1. Use Conventional Commit messages such as `feat:`, `fix:`, and `docs:`.
2. Release Please maintains a release pull request.
3. Merge the release pull request.
4. Release Please creates the tag and GitHub Release.
5. The published GitHub Release triggers `.github/workflows/publish.yml`.

The publish workflow installs the latest npm CLI because trusted publishing requires npm CLI 11.5.1 or newer.
