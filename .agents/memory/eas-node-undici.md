---
name: EAS Node version vs undici override
description: EAS build workers run a fixed Node.js version; unbounded >= overrides for undici can resolve to a major version that requires a newer Node.
---

## Rule
Never use `>=x.y.z` overrides for packages that have Node.js version requirements that differ across major versions. Use `^x.y.z` to pin the major.

## Why
EAS SDK 54 build workers run **Node.js v20.x**. The security patch `undici: '>=6.27.0'` resolved to `undici@8.7.0` on the EAS worker. `undici@8.x` calls `webidl.util.markAsUncloneable` at module load time, which only exists in Node.js 21+. This crashed the `EAGER_BUNDLE` phase before any JS code ran.

Error signature:
```
TypeError: webidl.util.markAsUncloneable is not a function
    at new CacheStorage (undici@8.7.0/lib/web/cache/cachestorage.js:20)
```
Phase: `EAGER_BUNDLE` — build fails before Gradle even starts.

## How to apply
- Security overrides for undici: use `^6.27.0` not `>=6.27.0`
- EAS logs are brotli-compressed (not gzip) — decompress with `brotli -d`
- Check Node version on EAS worker in the `SPIN_UP_BUILDER` phase log lines
- Any time a security advisory says "upgrade to >=X", check if X crosses a major boundary that changes Node requirements
