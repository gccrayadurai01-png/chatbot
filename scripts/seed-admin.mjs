#!/usr/bin/env node
/**
 * Creates or updates an admin user.
 *
 * The password is read from stdin, never from argv — a password in a command
 * argument lands in your shell history and in the process list.
 *
 *   npm run db:seed-admin -- you@cloudsufi.com
 */
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import pg from "pg";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: npm run db:seed-admin -- you@cloudsufi.com");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env first.");
  process.exit(1);
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Suppress echo so the password isn't printed as it's typed.
    const onData = (char) => {
      if (char.toString() === "\n" || char.toString() === "\r") {
        process.stdin.removeListener("data", onData);
      }
    };
    process.stdout.write(prompt);
    rl.output.write = (chunk, ...args) => {
      if (rl.stdoutMuted) return true;
      return process.stdout.constructor.prototype.write.call(rl.output, chunk, ...args);
    };
    rl.stdoutMuted = true;
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      rl.stdoutMuted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const password = await ask(`Password for ${email}: `);

if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? undefined
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash],
  );
  console.log(`Admin ready: ${email}`);
} catch (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
} finally {
  await client.end();
}
