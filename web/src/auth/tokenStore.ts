let _token: string | null = null
let _onForbidden: (() => void) | null = null

export const getToken = (): string | null => _token
export const setToken = (token: string): void => { _token = token }
export const clearToken = (): void => { _token = null }
export const setOnForbidden = (cb: () => void): void => { _onForbidden = cb }
export const triggerForbidden = (): void => { _onForbidden?.() }
