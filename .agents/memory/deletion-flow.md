---
name: Deletion flow architecture
description: The 5-step protected deletion flow with OTP, wait period, signed email link, and keyphrase
---

## Flow steps
1. `POST /api/deletion-requests` — requires MFA; creates request with OTP hash + cancel token; sends email with OTP
2. `POST /api/deletion-requests/:id/confirm-otp` — verifies OTP (15min expiry) + keyphrase if set; sets status=awaiting_link; sends email link after wait period elapses
3. User waits (24h for thread/date-range; 2 weeks for history/account)
4. `GET /api/deletion-requests/:id/execute-link` — validates signed token, sends final OTP email
5. `POST /api/deletion-requests/:id/execute-final` — verifies final OTP, soft-deletes threads

## Cancel at any time
- `POST /api/deletion-requests/:id/cancel` (authenticated, from app banner)
- `GET /api/deletion-requests/:id/cancel-link?token=<cancelToken>` (unauthenticated, from email link)

## Wait times
- thread / date-range: 24 hours
- history / account: 2 weeks

## Keyphrase
Stored as bcrypt hash + AES-256-GCM encrypted plaintext (key derived from SESSION_SECRET via scrypt). Requires MFA to set. Developer can retrieve plaintext via decrypt if user forgets.

**Why:** Multi-layer protection against compromised accounts and impulsive deletions.
