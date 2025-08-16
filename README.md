# SalesPark Route Utils v1 - Documentation

## @salespark/route-utils

Vendor-agnostic helpers for **Express.js** routes.  
Provides a unified way to wrap async route handlers, normalize responses, and handle logging without binding to a specific vendor (e.g., Rollbar, Sentry, Console).

By default, if no logger is provided, **no logs are emitted** (silent mode).

---

## 📦 Installation

```bash
npm install @salespark/route-utils
# or
yarn add @salespark/route-utils
```

Supports both **CommonJS** and **ESM** imports.

```ts
// ESM
import { wrapRoute, createResponder, makeRouteUtils, resolveRouteResponse } from "@salespark/route-utils";

// CommonJS
const { wrapRoute, createResponder, makeRouteUtils, resolveRouteResponse } = require("@salespark/route-utils");
```

---

## 🚀 Introduction

This utility reduces boilerplate in Express.js routes by enforcing:

- Consistent response shape across all endpoints
- Safe error handling with `try/catch` wrappers
- Prevention of double responses (`res.headersSent`)
- Configurable vendor-agnostic logging (console, Rollbar, Sentry, etc.)
- Predictable HTTP status codes for both success and error cases

---

## 📐 Response Shape Specification

All route handlers must return an object with the following structure:

```ts
{
  status: boolean;             // required: true for success, false for failure
  data?: any;                  // optional: payload for success or error
  http?: number;               // optional: explicit HTTP status code
  headers?: Record<string,any>;// optional: extra HTTP headers to set
  meta?: any;                  // optional: metadata (e.g., pagination info)
}
```

### Status Rules

- ✅ `status: true` → Success
- ❌ `status: false` → Failure
- 🚨 Missing `status` → treated as malformed response (`500` with `MissingStatus`)

### Default HTTP Mapping

- Success with data → `200 OK`
- Success without data (`null`, `undefined`, `""`) → `204 No Content`
- Failure → `400 Bad Request`
- Explicit `http` value (100–599) always overrides

---

## 🏗️ Factory: `makeRouteUtils`

```ts
import { makeRouteUtils } from "@salespark/route-utils";

const { wrapRoute, createResponder, resolveRouteResponse } = makeRouteUtils({
  logger: console.error, // or rollbar.error, sentry.captureException, etc.
  tagPrefix: "/routes/producers", // optional prefix for logs
});
```

### Parameters

- **`logger`**: `(payload, tag) => void`
- **`tagPrefix`**: string (optional)

### Returns

- `wrapRoute`
- `createResponder`
- `resolveRouteResponse`

---

## ⚡ Functions

### `wrapRoute`

```ts
router.get(
  "/achievements",
  validateAuth,
  wrapRoute(
    async (req, res) => {
      const producerId = res.locals.auth.producer_id;
      return ops.getProducerAchievements(producerId);
    },
    { tag: "GET /achievements" }
  )
);
```

---

### `createResponder`

```ts
router.get("/achievements", validateAuth, async (req, res) => {
  const respond = createResponder(res, { tag: "GET /achievements" });
  await respond(() => ops.getProducerAchievements(res.locals.auth.producer_id));
});
```

---

### `resolveRouteResponse`

```ts
const response = await ops.doSomething();
if (!resolveRouteResponse(res, response)) {
  res.status(500).json({ status: false, error: "No response sent" });
}
```

---

## 🧪 Usage Examples

### Example 1: Silent Mode (default)

```ts
app.get(
  "/ping",
  wrapRoute(async () => ({ status: true, data: "pong" }))
);
```

### Example 2: With Console Logger

```ts
const { wrapRoute } = makeRouteUtils({
  logger: (payload, tag) => console.log("[LOG]", tag, payload),
});
```

### Example 3: With Rollbar

```ts
const rollbar = require("./rollbar");

const { wrapRoute } = makeRouteUtils({
  logger: rollbar.error.bind(rollbar),
  tagPrefix: "[API] ",
});
```

### Example 4: POST with Validation

```ts
app.post(
  "/items",
  wrapRoute(async (req) => {
    if (!req.body.name) {
      return { status: false, data: { error: "ValidationError", message: "Name required" }, http: 422 };
    }
    return { status: true, data: { id: 1, name: req.body.name }, http: 201 };
  })
);
```

### Example 5: Using Sentry

```ts
import * as Sentry from "@sentry/node";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const { wrapRoute } = makeRouteUtils({
  logger: (payload, tag) => {
    Sentry.captureException(payload instanceof Error ? payload : new Error(JSON.stringify(payload)));
  },
});
```

---

## 📦 NPM Package

This module is published as:  
👉 [`@salespark/route-utils`](https://www.npmjs.com/package/@salespark/route-utils)

```bash
npm install @salespark/route-utils
```

---

## 📄 License

MIT © [SalesPark](https://salespark.io)

---

_Document version: 1_  
_Last update: 16-08-2025_
