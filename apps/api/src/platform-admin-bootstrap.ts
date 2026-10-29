import { createInterface } from "node:readline";
import { hash } from "@node-rs/argon2";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema, sqlClient } from "./db/client";
import { platformAdminPassword } from "./modules/auth";

function ask(prompt: string) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => readline.question(prompt, (answer) => {
    readline.close();
    resolve(answer.trim());
  }));
}

function askSecret(prompt: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Run this command in an interactive terminal so the password is not echoed.");
  }
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const input = process.stdin;
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (byte === 13 || byte === 10) {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte);
          process.stdout.write("*");
        }
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function argValue(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = z.email().parse((argValue("email") ?? await ask("DryCare platform admin email: ")).toLowerCase());
  // Non-interactive use (CI, or a terminal without raw mode) reads the password from the environment, never from argv.
  const password = process.env.DRYCARE_ADMIN_PASSWORD ?? await askSecret("Password (minimum 12 characters, with a symbol): ");
  const checked = platformAdminPassword.safeParse(password);
  if (!checked.success) throw new Error(checked.error.issues[0].message);
  const passwordHash = await hash(password);

  const result = await db.transaction(async (tx) => {
    let user = await tx.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (user && !user.isPlatformAdmin) {
      const memberships = await tx.query.memberships.findMany({ where: eq(schema.memberships.userId, user.id) });
      if (memberships.length) {
        throw new Error("This email already belongs to a store account. Use a separate dedicated DryCare admin email.");
      }
    }

    let platformOrg = await tx.query.organizations.findFirst({ where: eq(schema.organizations.slug, "drycare-platform") });
    if (!platformOrg) {
      [platformOrg] = await tx.insert(schema.organizations).values({
        name: "DryCare Platform",
        slug: "drycare-platform",
        status: "active",
        settings: { platformInternal: true },
      }).returning();
    }
    if (user?.isPlatformAdmin) {
      const otherMembership = await tx.query.memberships.findFirst({
        where: and(eq(schema.memberships.userId, user.id), ne(schema.memberships.organizationId, platformOrg.id)),
      });
      if (otherMembership) throw new Error("Platform admins must use a dedicated account without store memberships.");
    }

    let role = await tx.query.roles.findFirst({
      where: and(eq(schema.roles.organizationId, platformOrg.id), eq(schema.roles.key, "platform_admin")),
    });
    if (!role) {
      [role] = await tx.insert(schema.roles).values({
        organizationId: platformOrg.id,
        key: "platform_admin",
        name: "DryCare Platform Admin",
        permissions: [],
        isSystem: true,
      }).returning();
    }

    if (!user) {
      [user] = await tx.insert(schema.users).values({
        email,
        name: "DryCare Admin",
        passwordHash,
        isPlatformAdmin: true,
      }).returning();
    } else {
      [user] = await tx.update(schema.users).set({
        name: "DryCare Admin",
        passwordHash,
        isPlatformAdmin: true,
        status: "active",
        failedLogins: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      }).where(eq(schema.users.id, user.id)).returning();
    }

    const membership = await tx.query.memberships.findFirst({
      where: and(eq(schema.memberships.organizationId, platformOrg.id), eq(schema.memberships.userId, user.id)),
    });
    if (!membership) {
      await tx.insert(schema.memberships).values({
        organizationId: platformOrg.id,
        userId: user.id,
        roleId: role.id,
      });
    } else if (membership.roleId !== role.id) {
      await tx.update(schema.memberships).set({ roleId: role.id, status: "active" }).where(eq(schema.memberships.id, membership.id));
    }

    const branch = await tx.query.branches.findFirst({ where: eq(schema.branches.organizationId, platformOrg.id) });
    if (!branch) {
      await tx.insert(schema.branches).values({ organizationId: platformOrg.id, name: "Platform HQ", branchCode: "HQ" });
    }
    return { email: user.email };
  });

  console.log(`Platform admin ready: ${result.email}`);
  console.log("Sign in at http://localhost:3210/super-admin/login");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not create the platform admin.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
