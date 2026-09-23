# Plan: one raffle platform for many companies

**Status:** proposal only, not built. The current app serves one company, with two shared passwords.

## The idea in one paragraph

A single deployment hosts any number of companies.
- A **master user**, signed in by **email** (no password), creates a company and gets a **company code**, e.g. `odin-dashain`.
- Inside their company, the master user invites people by email and gives each a role: **Admin** (today's organiser) or **Finance**.
- Staff reach their company's raffle at `raffle.example.com/c/<company-code>`, or on its own subdomain.
- Companies can't see each other's data, settings, collectors or draws.

## Why change what works

- **Named logins instead of shared passwords.** You know exactly who confirmed each payment. Access is removed by un-inviting someone, not by rotating a password everyone knows. This fits the "finance limited to a few people" rule much better.
- **One install for every entity.** Each company gets its own settings and branding with nothing extra to deploy, which helps if you run several entities.

## Roles

| Role | Scope | Can |
|---|---|---|
| Platform owner | whole install | create or suspend companies, see usage. Usually just the operator. |
| Master | one company | everything Finance can, plus invite or remove users, set roles, rename the company or change its code, delete the company |
| Finance | one company | today's finance powers |
| Admin (organiser) | one company | today's organiser powers |
| Staff / public | one company | board, self-service (still gated by that company's access code), receipts |

## Sign-in: email one-time codes

1. The user enters their email and gets a 6-digit code, valid for 10 minutes. After 5 wrong tries the code is dead.
2. They get a session cookie, the same kind as today.
3. There are no passwords to store, reset or leak.
4. **This needs outbound email:** company SMTP, Microsoft 365, Google Workspace SMTP relay, or a provider such as Postmark, SES or Resend. This is the one new external dependency.
5. **Alternative: company SSO** (Google or Microsoft sign-in via OIDC). There's no email to send, and people leave automatically when their account is disabled. It's the better choice if all the companies share one identity provider. Otherwise use email codes.

## Data model

Move from one `raffle.json` to **SQLite**. It's still a single file, but it's safe for many companies and concurrent writes.

```
companies   (id, code UNIQUE, name, status, created_at)
users       (id, email UNIQUE, name, created_at)
memberships (company_id, user_id, role: master|finance|admin, invited_by, created_at)
login_codes (email, code_hash, expires_at, attempts)
sessions    (id, user_id, expires_at)
-- everything that exists today, each row carrying company_id:
settings, prizes, sales, batches, draws, collectors, audit
```

- **One rule everywhere:** every query is scoped by `company_id`, taken from the URL and checked against the user's membership. It's never taken from the request body.
- **Uploads:** QR images move to `uploads/<company_id>/…`.
- **Live updates:** each company gets its own event channel, so one company's sales never push updates to another's screens.

## URL shape

- `raffle.example.com/c/<code>` for the board, Get tickets and the draw stage. `…/c/<code>/manage` for the console. `raffle.example.com/` is the "sign in or create a company" page.
- Optional custom domain per company, e.g. `raffle.odin.com.np`, mapped to a company code.

## Migrating today's data

The current `raffle.json` is imported as one company. The master is whoever you name. Today's organiser and finance users are re-invited by email. Receipt links keep working through a redirect from `/?r=` to `/c/<code>/?r=`.

## Work plan

| Phase | What | Rough size |
|---|---|---|
| 1 | SQLite storage layer and moving `raffle.json` into it, with behaviour unchanged | 1–2 days |
| 2 | Email one-time-code sign-in, users and memberships, replacing the shared passwords | 2 days |
| 3 | Companies, company codes, `/c/<code>` routing, per-company scoping and live channels | 2–3 days |
| 4 | Master console: invite, remove, change role, rename, company code, audit per company | 1–2 days |
| 5 | Platform-owner page, custom domains, rate limits per company, docs and tests | 1–2 days |

The phases can be delivered one at a time. After phase 2 you already have named logins for a single company, which fixes the shared-password problem even if you never go multi-company.

## Decisions needed before building

1. **Sign-in:** email one-time codes (needs an email sender: which one?) or company SSO (Google or Microsoft?).
2. **Who can create a company:** anyone with an email, only invited emails, or only you as platform owner?
3. **Hosting:** one shared install for all entities, or one install per entity using the same image? The multi-company work only pays off with a shared install.
4. **Branding:** the theme is Dashain-specific today (kites, Devanagari greetings). Should companies be able to choose a theme or festival per event?
