import type { Request } from "express";

export interface IExtendedRequest extends Request {
  user?: { id: string; [key: string]: unknown };
  session?: { id: string; [key: string]: unknown };
}
