# Live message encryption regression test

Run the development API workflow, then:

```sh
pnpm --filter @workspace/api-server test:integration
```

The separate `integration-test` validation command runs this suite. It is not
part of `test` or `build`: the service must already be listening, and including
it in the server's build would create a startup dependency cycle.

Requirements:
- A development Clerk `CLERK_SECRET_KEY` (`sk_test_…`); live keys are refused.
- `DATABASE_URL` pointing at the running API's **development** database.
- `API_INTEGRATION_BASE_URL` including the API prefix (for example
  `http://127.0.0.1:8080/api`), or `REPLIT_DEV_DOMAIN` for the workspace proxy.

No pre-existing user's credentials are needed. The test creates a unique Clerk
test user with generated credentials, asks Clerk for a real development session,
and authenticates HTTP requests using its signed JWT. Authentication, routes,
database access, and encryption are not mocked. Tokens and credentials are never
printed or stored in files.

It creates a thread and sends a Unicode message via HTTP, confirms that the
database row starts with `enc:v1:`, and independently checks both GET endpoints
for the exact plaintext and absence of ciphertext in every returned message.
Missing configuration, a stopped server, empty responses, and rejected
authentication fail the suite rather than silently skipping it.

Cleanup deletes only the temporary user's threads/profiles, revokes the session,
and deletes the temporary Clerk user, including when assertions fail. Run only
against development services; never point this suite at production.
