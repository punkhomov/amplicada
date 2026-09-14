import 'fastify';
import type { User } from '../contracts/auth.js';

declare module 'fastify' {
  interface Session {
    user?: User;
  }
}
