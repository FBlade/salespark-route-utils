# SalesPark Route Utils v1 - Documentation

## @salespark/route-utils

Vendor-agnostic helpers for **Express.js** routes.  
Provides a unified way to wrap async route handlers, normalize responses, and handle logging without binding to a specific vendor (e.g., Rollbar, Sentry, Console).

By default, if no logger is provided, **no logs are emitted** (silent mode).

---

## 📦 Installation

```bash
yarn add @salespark/route-utils
# or
npm install @salespark/route-utils
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

- ✅ `status: true` → Success: The HTTP response will send **only the `data` directly** (e.g., `res.json(data)` for 200, or no content for 204).
- ❌ `status: false` → Failure: The HTTP response will send **only the error details directly** (e.g., `res.json({ error: "...", message: "..." })` for 400 or other codes).
- 🚨 Missing `status` → Treated as malformed response (`500` with basic error message).

### Default HTTP Mapping

- Success with data → `200 OK` (sends data directly)
- Success without data (`null`, `undefined`, `""`) → `204 No Content`
- Failure → `400 Bad Request` (sends error details directly)
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

## 🛠️ Support

Got stuck? Don’t panic — we’ve got you covered.

### 🤖 AI Assistant

We built a custom **AI Assistant** trained _only_ on `@salespark/route-utils`.  
It answers implementation and troubleshooting questions in real time:

👉 Ask the Route Utils GPT:  
https://chatgpt.com/g/g-68a9b742f240819197057ba3333230be-salespark-route-utils-v1

_(Free to use with a ChatGPT account)_

---

### 🔒 Internal Usage Notice

This package is primarily designed and maintained for internal use within the SalesPark ecosystem.
While it can technically be used in other Node.js/Mongoose projects, no official support or guarantees are provided outside of SalesPark-managed projects.

All code follows the same engineering standards applied across the SalesPark platform, ensuring consistency, reliability, and long-term maintainability of our internal systems.

⚡ Note: This package is most efficient and works best when used together with other official SalesPark packages, where interoperability and optimizations are fully leveraged.

Disclaimer: This software is provided “as is”, without warranties of any kind, express or implied. SalesPark shall not be held liable for any issues, damages, or losses arising from its use outside the intended SalesPark environment.

Organization packages: https://www.npmjs.com/org/salespark

---

## 📄 License

MIT © [SalesPark](https://salespark.io)

---

_Document version: 3_  
_Last update: 23-08-2025_
