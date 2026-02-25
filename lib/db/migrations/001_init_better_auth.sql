-- Better Auth Schema for Supabase
-- Run these migrations to set up the authentication tables

-- Create user table
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT,
  image TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT DEFAULT 'user',
  organizationId TEXT
);

-- Create session table
CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  expiresAt TIMESTAMP NOT NULL,
  token TEXT UNIQUE NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

-- Create account table (for OAuth)
CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TIMESTAMP,
  refreshTokenExpiresAt TIMESTAMP,
  scope TEXT,
  password TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create verification table
CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create organization table
CREATE TABLE IF NOT EXISTS "organization" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Create organizationMember table
CREATE TABLE IF NOT EXISTS "organizationMember" (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create organizationInvitation table
CREATE TABLE IF NOT EXISTS "organizationInvitation" (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_user_email ON "user"(email);
CREATE INDEX idx_session_userId ON "session"(userId);
CREATE INDEX idx_account_userId ON "account"(userId);
CREATE INDEX idx_organizationMember_userId ON "organizationMember"(userId);
CREATE INDEX idx_organizationMember_organizationId ON "organizationMember"(organizationId);
CREATE INDEX IF NOT EXISTS idx_organizationInvitation_email ON "organizationInvitation"(email);
