import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Finding, PipelineStep } from "./audit-report-types";

export const managedAgentSession = pgTable("managed_agent_session", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  anthropicSessionId: text("anthropic_session_id").notNull().unique(),
  title: text("title").notNull().default("New chat"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  agentId: text("agent_id").notNull(),
  environmentId: text("environment_id").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("cl"),
  workflowRunId: text("workflow_run_id"),
});

export const auditReport = pgTable("audit_report", {
  id: text("id").primaryKey(),
  anthropicSessionId: text("anthropic_session_id").notNull().unique(),
  sessionId: text("session_id").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  policyUrl: text("policy_url"),
  policyLabel: text("policy_label").notNull(),
  complianceScore: integer("compliance_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  findingsJson: jsonb("findings_json").$type<Finding[]>().notNull(),
  pipelineJson: jsonb("pipeline_json").$type<PipelineStep[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
