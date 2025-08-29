import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseTimeInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - startTime;

        // Log response time
        this.logger.log(`${method} ${url} - ${responseTime}ms`);

        // Log warning if exceeding 100ms target
        if (responseTime > 100) {
          this.logger.warn(
            `API response time exceeded target: ${method} ${url} took ${responseTime}ms (target: <100ms)`
          );
        }

        // Add response time header
        const response = context.switchToHttp().getResponse();
        response.setHeader("X-Response-Time", `${responseTime}ms`);
      })
    );
  }
}
