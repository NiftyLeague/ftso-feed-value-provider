import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { Response } from "express";

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();

    // Handle both string and object responses
    let errorResponse: any;

    if (typeof exceptionResponse === "string") {
      errorResponse = {
        error: HttpStatus[status] || "Unknown Error",
        message: exceptionResponse,
        statusCode: status,
        timestamp: Date.now(),
      };
    } else if (typeof exceptionResponse === "object") {
      errorResponse = {
        ...exceptionResponse,
        timestamp: (exceptionResponse as any).timestamp || Date.now(),
      };
    } else {
      errorResponse = {
        error: HttpStatus[status] || "Unknown Error",
        message: "An error occurred",
        statusCode: status,
        timestamp: Date.now(),
      };
    }

    response.status(status).json(errorResponse);
  }
}
