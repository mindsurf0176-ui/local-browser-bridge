import type { BridgeErrorDetails, ErrorPayload } from "./types";

export class AppError<TDetails = BridgeErrorDetails> extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: TDetails;

  constructor(
    message: string,
    statusCode = 500,
    code = "internal_error",
    details?: TDetails
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(error: unknown): { statusCode: number; payload: ErrorPayload } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          ...(error.details ? { details: error.details } : {})
        }
      }
    };
  }

  if (error instanceof SyntaxError) {
    return {
      statusCode: 400,
      payload: {
        error: {
          code: "invalid_json",
          message: "Request body must be valid JSON.",
          statusCode: 400
        }
      }
    };
  }

  return {
    statusCode: 500,
    payload: {
      error: {
        code: "internal_error",
        message: "Internal server error.",
        statusCode: 500
      }
    }
  };
}

export function writeJsonLine(stream: NodeJS.WritableStream, payload: unknown): void {
  stream.write(JSON.stringify(payload, null, 2) + "\n");
}
