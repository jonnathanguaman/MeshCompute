import type { UserDTO, UserRole } from '@meshcompute/contracts';
import type { SqliteDatabase } from '../connection.js';

export interface UserRecord extends UserDTO {
  passwordHash: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string;
  created_at: string;
  updated_at: string;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly database: SqliteDatabase) {}

  findByEmail(email: string): UserRecord | undefined {
    const row = this.database.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | UserRow
      | undefined;
    return row ? mapUser(row) : undefined;
  }

  findById(id: string): UserRecord | undefined {
    const row = this.database.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined;
    return row ? mapUser(row) : undefined;
  }

  create(input: {
    id: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    displayName: string;
    now: string;
  }): UserRecord {
    this.database
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, display_name, created_at, updated_at)
         VALUES (@id, @email, @passwordHash, @role, @displayName, @now, @now)`,
      )
      .run(input);
    const user = this.findById(input.id);
    if (!user) throw new Error('User insert did not return a record.');
    return user;
  }

  createSession(input: { tokenHash: string; userId: string; now: string; expiresAt: string }): void {
    this.database
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
         VALUES (@tokenHash, @userId, @now, @expiresAt)`,
      )
      .run(input);
  }

  findUserBySession(tokenHash: string, now: string): UserRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT users.* FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(tokenHash, now) as UserRow | undefined;
    return row ? mapUser(row) : undefined;
  }

  deleteSession(tokenHash: string): void {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
}
