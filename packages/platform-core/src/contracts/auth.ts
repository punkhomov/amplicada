export interface User {
  id: string;
  login: string;
}

export interface AuthResult {
  user: User;
}
