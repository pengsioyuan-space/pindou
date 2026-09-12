import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  suffix: text("suffix").notNull(),
  label: text("label").notNull().default(""),
  durationDays: integer("duration_days").notNull(),
  createdAt: integer("created_at").notNull(),
  activatedAt: integer("activated_at"),
  expiresAt: integer("expires_at"),
  device1: text("device1"),
  device2: text("device2"),
  revoked: integer("revoked").notNull().default(0),
});
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    role: text("role").notNull(),
    cardId: text("card_id").references(() => cards.id),
    deviceHash: text("device_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("idx_sessions_card").on(t.cardId),
    index("idx_sessions_expiry").on(t.expiresAt),
  ],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    name: text("name").notNull(),
    data: text("data").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_projects_card_updated").on(t.cardId, t.updatedAt)],
);
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_rate_expiry").on(t.expiresAt)],
);
