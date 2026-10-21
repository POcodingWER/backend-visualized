import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from './request-id';
import { reportToSentry } from './sentry';

export interface ErrorBody {
  statusCode: number;
  message: unknown;
  requestId: string;
  /** 1·4·6장 쿨다운처럼 화면이 읽는 이유 코드 등, 원래 응답에 있던 값은 그대로 둔다 */
  [extra: string]: unknown;
}

/**
 * 오류 응답 모양을 하나로: { statusCode, message, requestId, ...원래 있던 값 }.
 * 예상한 오류(HttpException)는 그 내용을, 예상 못 한 오류는 "Internal server error"만 보낸다 (스택·SQL은 절대 응답에 안 실음).
 */
export function toErrorBody(exception: unknown, requestId: string): ErrorBody {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const original =
      typeof response === 'string' ? { message: response } : (response as Record<string, unknown>);
    return {
      ...original,
      statusCode,
      message: original.message ?? exception.message,
      requestId,
    };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
    requestId,
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = String(request.id ?? response.getHeader(REQUEST_ID_HEADER) ?? 'unknown');
    const body = toErrorBody(exception, requestId);

    // 5xx만 오류로 남긴다 (4xx는 요청 로그의 상태 코드로 충분)
    if (body.statusCode >= 500) {
      this.log.error(exception instanceof Error ? exception : new Error(String(exception)));
      reportToSentry(exception, requestId);
    }
    // SSE처럼 이미 응답을 보내기 시작했으면 더 쓸 수 없다
    if (response.headersSent) return;
    response.status(body.statusCode).json(body);
  }
}
