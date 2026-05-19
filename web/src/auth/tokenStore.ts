let _token: string | null = null

export const getToken = (): string | null => _token
export const setToken = (token: string): void => { _token = token }
export const clearToken = (): void => { _token = null }
