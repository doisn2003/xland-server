export class DomainError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly details?: ReadonlyArray<{ field: string; code: string }>) { super(message); }
}
export function invalid(field: string): never {
  throw new DomainError(400, 'INVALID_INPUT', 'Kiểm tra thông tin đầu vào', [{ field, code: 'INVALID_VALUE' }]);
}
export function missing(): never { throw new DomainError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên'); }
export function unauthenticated(): never { throw new DomainError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập'); }
