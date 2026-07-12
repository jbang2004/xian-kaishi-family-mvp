import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const familyState = sqliteTable("family_state", {
  familyId: text("family_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
