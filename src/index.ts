/****************************************************************************************************************
 * ##: Route Utils (TypeScript)
 * Vendor-agnostic helpers for Express-like route handlers.
 *
 * What you get:
 *  - Normalized responses: { status:boolean, data?, http?, headers?, meta? }
 *  - Safe guards against double responses (res.headersSent)
 *  - No vendor lock-in for logging (optional logger function, silent by default)
 *  - Two ergonomics:
 *      a) wrapRoute(handler, { tag?, logger? }) -> middleware
 *      b) createResponder(res, { tag?, logger? }) -> in-route responder
 *  - Core primitive: resolveRouteResponse(res, response) -> boolean
 *
 * Logging:
 *  - Provide a function logger(payload, tag?) if you want logs (e.g. rollbar.error.bind(rollbar))
 *  - If omitted, nothing is logged (silent mode)
 *
 * History:
 * 16-08-2025: Initial version
 ****************************************************************************************************************/

export type LoggerFn = (payload: unknown, tag?: unknown) => void;

/**
 * Minimal response interface to avoid a hard dependency on Express types.
 * Any Express-like object with these methods/properties is supported.
 */
export interface ResLike {
  status: (code: number) => ResLike;
  json: (body?: unknown) => ResLike;
  send: (body?: unknown) => ResLike;
  setHeader?: (name: string, value: string) => void;
  headersSent?: boolean;
  // Allow extra properties commonly present on Express' res
  [key: string]: any;
}

/**
 * Normalized API response contract used throughout the utilities.
 * - `status` is mandatory and must be boolean.
 * - `http` is optional and, when valid, overrides default status code mapping.
 * - `headers` are optional additional response headers to apply.
 */
export interface ApiResponse<T = unknown, M = unknown> {
  status: boolean;
  data?: T;
  http?: number;
  headers?: Record<string, string>;
  meta?: M;
}

/** No-op logger (silent). Used when no logger function is provided. */
const noopLogger: LoggerFn = () => {};

/****************************************************************************************************************
 * ##: Read error message for sanitizer
 * Extracts a safe message from error input, preferring string reason or message.
 * @param {unknown} error - Error input to inspect for safe message extraction
 * @param {boolean} allowErrorMessage - Allow exposing Error.message when error is an Error instance
 * @returns {string | undefined} - Safe message string or undefined when no safe message is available
 * History:
 * 18-03-2026: Created
 ****************************************************************************************************************/
const readErrorMessage = (error: unknown, allowErrorMessage: boolean): string | undefined => {
  if (error instanceof Error) return allowErrorMessage ? error.message : undefined;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);

  if (error && typeof error === "object") {
    const err = error as any;
    const reason = err?.reason;
    if (typeof reason === "string" && reason.trim()) return reason;

    const message = err?.message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return undefined;
};

/****************************************************************************************************************
 * ##: Normalize error message for output
 * Removes newlines, trims whitespace, and caps the maximum length for safe responses.
 * @param {string} message - Message to normalize for API output
 * @param {number} maxLength - Maximum length before truncating the message
 * @returns {string} - Normalized message safe for response payloads
 * History:
 * 18-03-2026: Created
 ****************************************************************************************************************/
const sanitizeMessage = (message: string, maxLength: number): string => {
  const cleaned = message.replace(/[\r\n]+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
};

/****************************************************************************************************************
 * ##: Sanitize error response payload
 * Builds a safe error object with optional exposure of Error.message when explicitly allowed.
 * @param {unknown} error - Raw error input to sanitize for response output
 * @param {object} options - Optional settings for sanitizer behavior
 * @param {number} options.maxLength - Maximum length for the output error message
 * @param {boolean} options.allowErrorMessage - Allow Error.message when error is an Error instance
 * @returns {{ error: string }} - Sanitized error payload with a safe error message
 * History:
 * 18-03-2026: Created
 ****************************************************************************************************************/
export const errorSanatizer = (
  error: unknown,
  options: {
    maxLength?: number;
    allowErrorMessage?: boolean;
  } = {},
) => {
  const allowErrorMessage = options.allowErrorMessage === true;
  const maxLength = Number.isFinite(options.maxLength) && options.maxLength! > 0 ? Math.floor(options.maxLength!) : 500;
  const message = readErrorMessage(error, allowErrorMessage);

  return { error: message ? sanitizeMessage(message, maxLength) : "Unexpected error" };
};

/****************************************************************************************************************
 * ##: Create route utility helpers with defaults
 * Builds helper functions bound to a default logger and tag prefix for consistent route handling.
 * @param {LoggerFn} logger - Optional logger for reporting unexpected shapes or errors
 * @param {string} tagPrefix - Optional prefix appended to generated log tags
 * @returns {object} - Helper bundle: wrapRoute, createResponder, resolveRouteResponse, errorSanatizer
 * History:
 * 16-08-2025: Created
 ****************************************************************************************************************/
export const makeRouteUtils = ({
  logger = noopLogger,
  tagPrefix = "",
}: {
  logger?: LoggerFn;
  tagPrefix?: string;
} = {}) => {
  /****************************************************************************************************************
   * ##: Wrap async route handlers
   * Executes an async handler, normalizes its ApiResponse output, and logs unexpected failures when configured.
   * @param {Function} handler - Async route handler: (req, res) => ApiResponse | Promise<ApiResponse>
   * @param {object} options - Optional tag/logger overrides for this handler
   * @returns {Function} - Express-style middleware (req, res, next) => Promise<void>
   * History:
   * 16-08-2025: Created
   ****************************************************************************************************************/
  const wrapRoute = (handler: (req: any, res: ResLike) => Promise<ApiResponse> | ApiResponse, options: { tag?: string; logger?: LoggerFn } = {}) => {
    const routeLogger: LoggerFn = typeof options.logger === "function" ? options.logger : logger;

    return async (req: any, res: ResLike, _next?: any) => {
      // Build a tag for logging; default to METHOD + originalUrl
      const baseTag = options.tag || `${req?.method ?? "?"} ${req?.originalUrl ?? "?"}`;
      const tag = tagPrefix ? `${tagPrefix}${baseTag}` : baseTag;

      try {
        const response = await handler(req, res);
        if (resolveRouteResponse(res, response)) return; // Early exit: a response has been sent

        // If we got here, the handler returned an unexpected shape
        routeLogger({ message: "Unexpected response shape", response, route: tag }, tag);

        if (!res.headersSent) {
          res.status(500).json({ error: "UnexpectedResponseShape" });
        }
      } catch (err) {
        // Unhandled error in the handler
        routeLogger(err, `${tag}/catch`);

        if (!res.headersSent) {
          res.status(500).json({ error: (err as any)?.message || "Unexpected error" });
        }
      }
    };
  };

  /****************************************************************************************************************
   * ##: Create a responder helper for in-route use
   * Runs a work function that returns an ApiResponse and sends a normalized response to the client.
   * @param {ResLike} res - Express-like response object
   * @param {object} options - Optional tag/logger overrides for this responder
   * @returns {Function} - Work executor: (workFn) => Promise<true>
   * History:
   * 16-08-2025: Created
   ****************************************************************************************************************/
  const createResponder = (res: ResLike, options: { tag?: string; logger?: LoggerFn } = {}) => {
    const tagBase = options.tag;
    const routeLogger: LoggerFn = typeof options.logger === "function" ? options.logger : logger;

    return async (workFn: () => Promise<ApiResponse> | ApiResponse) => {
      try {
        const response = await workFn();
        if (resolveRouteResponse(res, response)) return true; // Responded successfully

        // Unexpected shape
        routeLogger({ message: "Unexpected response shape", response }, tagBase || "createResponder");

        if (!res.headersSent) {
          res.status(500).json({ status: false, error: "UnexpectedResponseShape" });
        }
        return true;
      } catch (error) {
        // Unhandled error inside workFn
        routeLogger(error, `${tagBase || "createResponder"}/catch`);

        if (!res.headersSent) {
          res.status(500).json({ status: false, error: (error as any)?.message || "Unexpected error" });
        }
        return true;
      }
    };
  };

  return { wrapRoute, createResponder, resolveRouteResponse, errorSanatizer };
};

/****************************************************************************************************************
 * ##: Resolve and send ApiResponse payloads
 * Normalizes a route response, applies headers/status, and prevents double sends when headers are already sent.
 * @param {ResLike} res - Express-like response object
 * @param {ApiResponse} response - ApiResponse payload with a required boolean status
 * @returns {boolean} - True if a response was sent; false when res is invalid
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Changed response method to directly use response.data
 ****************************************************************************************************************/
export const resolveRouteResponse = (res: ResLike, response: any): boolean => {
  try {
    // Guard: ensure `res` looks like a valid Express-like response object
    if (!res || typeof res.status !== "function" || typeof res.send !== "function") return false;

    // Prevent double responses
    if (res.headersSent) return true;

    // Validate presence of `status`
    const hasStatus = response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "status");
    if (!hasStatus) {
      res.status(500).json({ error: "MissingStatus", message: "Missing `status` on response object" });
      return true;
    }

    const isOk = response.status === true;
    const isFail = response.status === false;

    // Compute HTTP code:
    //  - If a valid custom `http` is provided (100–599), use it.
    //  - Otherwise:
    //    - Success with undefined/null/empty-string data => 204
    //    - Success with data => 200
    //    - Failure => 400
    const explicit = Number.isInteger(response?.http) && response.http >= 100 && response.http <= 599;
    const http = explicit ? response.http : isOk ? (response.data === undefined || response.data === null || response.data === "" ? 204 : 200) : 400;

    // Apply optional headers
    if (response?.headers && typeof response.headers === "object") {
      for (const [k, v] of Object.entries<string>(response.headers)) {
        try {
          res.setHeader?.(k, String(v));
        } catch {
          /* ignore header errors */
        }
      }
    }

    // Success path
    if (isOk) {
      if (http === 204) {
        res.status(http).send();
      } else {
        res.status(http).json(response.data);
      }
      return true;
    }

    // Error path
    if (isFail) {
      const raw = response.data;
      const errBody =
        raw instanceof Error
          ? { error: raw.name || "Error", message: raw.message }
          : raw && typeof raw === "object"
            ? {
                ...((raw as any).error ? { error: (raw as any).error } : {}),
                ...((raw as any).message ? { message: (raw as any).message } : {}),
              }
            : { error: "RequestFailed", message: typeof raw === "string" ? raw : "Request failed" };

      res.status(http).json(errBody);
      return true;
    }

    // Fallback: `status` is neither true nor false
    res.status(500).json({ status: false, error: "InvalidStatusField", message: "`status` must be boolean" });
    return true;
  } catch (error: any) {
    // Absolute last resort: catch unexpected errors inside the responder
    try {
      if (!res.headersSent) res.status(500).json({ status: false, error: "UnhandledResponderError", message: error?.message || "Unexpected error" });
      return true;
    } catch {
      // If even this fails, we assume there's nothing else we can safely do
      return true;
    }
  }
};

/****************************************************************************************************************
 * Pre-bound (silent) helpers
 * These export a default, no-logger configuration so consumers can import directly without a factory.
 ****************************************************************************************************************/
const silent = makeRouteUtils(); // logger: noop (silent)
export const wrapRoute = silent.wrapRoute;
export const createResponder = silent.createResponder;
export const errorSanatizer = silent.errorSanatizer;

/** Default export bundle (optional convenience) */
export default {
  makeRouteUtils,
  wrapRoute,
  createResponder,
  errorSanatizer,
  resolveRouteResponse,
};
