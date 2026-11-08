import { HttpException } from '@nestjs/common';

/** error ของระบบ: body = { error: CODE, ...extra } */
export class AppError extends HttpException {
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super({ error: code, ...extra }, status);
  }
}

/** ข้อผิดพลาดจาก raise exception ใน RPC → HTTP */
const RPC_ERRORS: Record<string, number> = {
  PLAYER_NOT_FOUND: 403,
  NOT_SPUN: 400,
  NOT_CASH_SEGMENT: 400,
  NO_PRIZES_LEFT: 410,
  ALREADY_SPUN: 409,
  NOT_UNLOCKED: 403,
  QTY_BELOW_GIVEN: 400,
  CASH_WEIGHT_ZERO: 500,
  WEIGHTS_EMPTY: 400,
  WEIGHTS_INVALID_CODES: 400,
  WEIGHTS_INVALID_VALUE: 400,
  WEIGHTS_SUM_NOT_100: 400,
  CAMPAIGN_NOT_FOUND: 404,
  WHEEL_NOT_FOUND: 404,
  CAMPAIGN_CLOSED: 403,
  WHEEL_CLOSED: 403,
  NO_SPINS_LEFT: 403,
  STAKE_NOT_FOUND: 400,
  HANDS_INVALID: 400,
  HANDS_EMPTY: 400,
  INVALID_MODE: 400,
  DELTA_ZERO: 400,
  SPINS_BELOW_USED: 409,
};

export function throwRpcError(err: { message?: string }): never {
  const code = Object.keys(RPC_ERRORS).find((k) => err.message?.includes(k));
  if (!code) throw err;
  // ld_spin คืน PLAYER_NOT_FOUND เมื่อ user ถูกปิด
  const publicCode = code === 'PLAYER_NOT_FOUND' ? 'PLAYER_DISABLED' : code;
  throw new AppError(RPC_ERRORS[code], publicCode);
}

/** ตรวจผล query ของ supabase-js */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}