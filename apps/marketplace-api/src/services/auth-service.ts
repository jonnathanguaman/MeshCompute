import { randomUUID } from 'node:crypto';
import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthSessionResponse,
  UserDTO,
} from '@meshcompute/contracts';
import { UserRepository, type UserRecord } from '../db/core/user-repository.js';
import { AppError } from '../errors.js';
import { generateToken, hashToken } from '../security/tokens.js';
import { hashPassword, passwordMatches } from '../security/passwords.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function publicUser(record: UserRecord): UserDTO {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    displayName: record.displayName,
    createdAt: record.createdAt,
  };
}

export class AuthService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: UserRepository,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  register(input: AuthRegisterRequest): AuthSessionResponse {
    const email = input.email.toLowerCase();
    if (this.repository.findByEmail(email)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    const user = this.repository.create({
      id: `u_${randomUUID()}`,
      email,
      passwordHash: hashPassword(input.password),
      role: input.role,
      displayName: input.displayName,
      now: this.now().toISOString(),
    });
    return this.createSession(user);
  }

  login(input: AuthLoginRequest): AuthSessionResponse {
    const user = this.repository.findByEmail(input.email.toLowerCase());
    if (!user || !passwordMatches(input.password, user.passwordHash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    return this.createSession(user);
  }

  authenticate(rawToken: string | undefined): UserDTO {
    if (!rawToken) {
      throw new AppError(401, 'UNAUTHENTICATED', 'A session token is required.');
    }
    const user = this.repository.findUserBySession(hashToken(rawToken), this.now().toISOString());
    if (!user) {
      throw new AppError(401, 'INVALID_SESSION', 'The session is invalid or has expired.');
    }
    return publicUser(user);
  }

  logout(rawToken: string | undefined): void {
    if (!rawToken) return;
    this.repository.deleteSession(hashToken(rawToken));
  }

  private createSession(user: UserRecord): AuthSessionResponse {
    const token = generateToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    this.repository.createSession({
      tokenHash: hashToken(token),
      userId: user.id,
      now: now.toISOString(),
      expiresAt,
    });
    return { user: publicUser(user), token, expiresAt };
  }
}
