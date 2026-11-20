-- Migration 005: User MFA Recovery Codes Hash
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes_hash TEXT;
