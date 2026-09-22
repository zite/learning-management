# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Report it privately through
[GitHub's advisory form](https://github.com/zite/learning-management/security/advisories/new),
or email **security@zite.com**. We'll acknowledge within three working days and keep
you updated until it's resolved. If you'd like credit in the advisory, say so and
we'll include you.

## Scope

This repository is a **template**. It is installed into a workspace that you run, so
a report against it is about the application code here — endpoint authorization, data
exposure between people or organizations, injection through user-supplied content,
that kind of thing.

Vulnerabilities in the **Zite platform itself** (auth, the endpoint runtime, hosting)
go to security@zite.com too, but say which you mean.

## What we already know and treat as by design

- The demo data is public sample content, including a passphrase used as a quiz
  answer. It is illustrative, not a credential.
- The certificate verification page is deliberately public and unauthenticated. It
  discloses only the recipient name, course title and issue/expiry dates — that is
  what verification is for.
- The Learner Portal is an external app. Which strangers can sign in is a per-install
  policy under **Settings → Academy**, not a code-level guarantee.

## Supported versions

This is a template, not a released library — fixes land on `main` and you pick them
up by merging. There are no maintained release branches.
