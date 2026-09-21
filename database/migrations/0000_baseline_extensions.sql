-- ===========================================================================
-- 0000_baseline_extensions
--
-- The only schema change in Phase 1. Phase 1 exists to prove the toolchain and
-- the migration pipeline work end to end, so this migration deliberately does
-- NOT create domain tables — those arrive in Phases 2-7, each in its own
-- migration, so every schema change stays reviewable as a small diff.
--
-- It is not empty, though. These extensions are required by work already
-- specified for the next two phases, and enabling them now means the first
-- domain migration is not doing two unrelated things at once.
--
-- Both are PostgreSQL "trusted" extensions since PG13, so the database owner
-- can create them without superuser rights. That matters: the application
-- role deliberately is not a superuser.
-- ===========================================================================

-- citext: case-insensitive text.
--
-- Required by Phase 2 for `users.username`. A login system must treat
-- "cashier1", "Cashier1", and "CASHIER1" as the same account. The alternative
-- is lowercasing in application code, which fails the moment a row is inserted
-- by a seed script, a migration, or by hand — and then two accounts exist that
-- the application believes are one.
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_trgm: trigram similarity matching.
--
-- Required by Phase 3 for subscriber search. §21 targets 20,000 subscribers,
-- and support staff search by partial name and partial account number
-- ("dela cruz", "1023"). A leading-wildcard LIKE cannot use a B-tree index and
-- degrades to a sequential scan; a GIN trigram index keeps that search fast.
--
-- Creating the extension here, rather than in Phase 3, means the Phase 3
-- migration only has to add the index it needs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
