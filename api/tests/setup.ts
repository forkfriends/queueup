import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../migrations/001_init.sql?raw";

function normalizeQueries(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|\r\n)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((query) => `${query};`);
}

await applyD1Migrations(env.DB, [
  { name: "001_init.sql", queries: normalizeQueries(schemaSql) },
]);
