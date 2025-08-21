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
 * ##: Factory
 * makeRouteUtils({ logger?, tagPrefix? })
 *
 * Creates helpers bound to provided defaults, so you can avoid passing the same logger/tag repeatedly.
 *
 * @param logger    Optional function `(payload, tag?) => void`. If omitted, no logs are emitted.
 * @param tagPrefix Optional prefix applied to all generated tags (e.g., a file or module path).
 *
 * @returns { wrapRoute, createResponder, resolveRouteResponse }
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
   * ##: wrapRoute(handler, options?)
   * Express-style middleware wrapper:
   *  - Executes your async handler and expects an ApiResponse
   *  - Uses resolveRouteResponse to send output
   *  - Catches and logs unexpected shapes/errors (only if a logger is provided)
   *
   * @param handler  Async route handler: (req, res) => ApiResponse | Promise<ApiResponse>
   * @param options  { tag?: string; logger?: LoggerFn }
   * @returns        (req, res, next) => Promise<void>
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
   * ##: createResponder(res, options?)
   * In-route responder:
   *  - Lets you keep the route signature untouched
   *  - You call it with a work function returning an ApiResponse
   *  - Ensures normalized output and consistent error handling
   *
   * @param res      Express-like response object
   * @param options  { tag?: string; logger?: LoggerFn }
   * @returns        (workFn) => Promise<true>
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

  return { wrapRoute, createResponder, resolveRouteResponse };
};

/****************************************************************************************************************
 * ##: Core Primitive - Resolve Route Response
 * resolveRouteResponse(res, response) => boolean
 *
 * Normalizes and sends the HTTP response based on the ApiResponse contract:
 *   - Validates the `res` object
 *   - Prevents double responses (`headersSent`)
 *   - Applies optional headers
 *   - Chooses HTTP status code (custom `http` if valid; else 200/204/400 defaults)
 *   - Serializes success/error shapes predictably
 *
 * @param res       Express-like response object
 * @param response  Expected ApiResponse (must include boolean `status`)
 * @returns         true if a response was sent; false if `res` looked invalid (no send)
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

/** Default export bundle (optional convenience) */
export default {
  makeRouteUtils,
  wrapRoute,
  createResponder,
  resolveRouteResponse,
};
