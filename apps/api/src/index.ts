import { createDb } from "@apotek/db";
import { createApp } from "./app";
import { supabaseVerifier } from "./auth";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see apps/api/.env.example)`);
  return value;
}

const port = Number(process.env.PORT ?? 3101);
const db = createDb(required("DATABASE_URL"));
const verifyToken = supabaseVerifier({ supabaseUrl: required("SUPABASE_URL") });

createApp({ db, verifyToken }).listen(port);
console.log(`apotek-api listening on :${port}`);
