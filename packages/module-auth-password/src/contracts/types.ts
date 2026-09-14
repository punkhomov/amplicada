// Auth Password Contracts
// Типы для модуля авторизации через пароль.

export interface LoginRequest {
  login: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: string;
    login: string;
  };
}
