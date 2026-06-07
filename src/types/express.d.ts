declare module 'express' {
  import type { IncomingMessage, ServerResponse } from 'node:http';

  export type NextFunction = (error?: unknown) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
  export type ErrorRequestHandler = (error: unknown, req: Request, res: Response, next: NextFunction) => void | Promise<void>;

  export interface Request extends IncomingMessage {
    body?: unknown;
    query: Record<string, string | string[] | undefined>;
    params: Record<string, string>;
    path: string;
    ip?: string;
    accepts(type: string): string | false;
    is(type: string | string[]): string | false | null;
  }

  export interface Response extends ServerResponse {
    locals: Record<string, unknown>;
    json(body: unknown): Response;
    status(code: number): Response;
    send(body: unknown): Response;
    type(contentType: string): Response;
  }

  export interface ExpressApp {
    disable(name: string): void;
    use(...middleware: Array<RequestHandler | ErrorRequestHandler | unknown>): void;
    get(path: string, ...handler: RequestHandler[]): void;
    post(path: string, ...handler: RequestHandler[]): void;
    delete(path: string, ...handler: RequestHandler[]): void;
    all(path: string, ...handler: RequestHandler[]): void;
    listen(port: number, host: string, callback?: () => void): void;
  }

  export interface ExpressFactory {
    (): ExpressApp;
    json(options?: { limit?: string | number; type?: string | string[] }): RequestHandler;
  }

  const express: ExpressFactory;
  export default express;
}
