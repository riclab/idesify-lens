/**
 * Diagnose why a chat session doesn't have an audit report.
 *
 *   pnpm dlx tsx scripts/debug-report.ts <chatId>
 *
 * <chatId> is the UUID in the URL: /chat/<chatId>/report
 *
 * Reports:
 *   1. Whether the chat row exists and which Anthropic session/agent it points to.
 *   2. Whether an audit_report row exists for that Anthropic session.
 *   3. Whether the agent emitted a `submit_findings` custom_tool_use event.
 *   4. The matching custom_tool_result, including any tool error text.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditReport, managedAgentSession } from "@/lib/schema";
import { getAnthropic } from "@/lib/anthropic";

async function main() {
  const chatId = process.argv[2]?.trim();
  if (!chatId) {
    console.error("usage: pnpm dlx tsx scripts/debug-report.ts <chatId>");
    process.exit(1);
  }

  const [chat] = await db
    .select()
    .from(managedAgentSession)
    .where(eq(managedAgentSession.id, chatId))
    .limit(1);

  if (!chat) {
    console.error(`No chat found with id=${chatId}`);
    process.exit(1);
  }

  console.log("=== chat ===");
  console.log({
    id: chat.id,
    title: chat.title,
    jurisdiction: chat.jurisdiction,
    anthropicSessionId: chat.anthropicSessionId,
    agentId: chat.agentId,
    workflowRunId: chat.workflowRunId,
  });

  const [report] = await db
    .select()
    .from(auditReport)
    .where(eq(auditReport.anthropicSessionId, chat.anthropicSessionId))
    .limit(1);

  console.log("\n=== audit_report row ===");
  if (report) {
    console.log({
      id: report.id,
      policyLabel: report.policyLabel,
      complianceScore: report.complianceScore,
      riskLevel: report.riskLevel,
      findingsCount: Array.isArray(report.findingsJson)
        ? report.findingsJson.length
        : "n/a",
      pipelineSteps: Array.isArray(report.pipelineJson)
        ? report.pipelineJson.length
        : "n/a",
      createdAt: report.createdAt,
    });
  } else {
    console.log("(none — this is why the Report tab shows 'not ready')");
  }

  console.log("\n=== Anthropic session events ===");
  const client = getAnthropic();
  const page = await client.beta.sessions.events.list(chat.anthropicSessionId, {
    limit: 200,
  });

  type Ev = {
    id?: string;
    type: string;
    name?: string;
    custom_tool_use_id?: string;
    is_error?: boolean;
    content?: unknown;
    input?: unknown;
    stop_reason?: { type?: string };
  };

  const events = page.data as unknown as Ev[];
  console.log(`fetched ${events.length} events (limit 200)`);

  const typeCounts = new Map<string, number>();
  for (const ev of events) {
    typeCounts.set(ev.type, (typeCounts.get(ev.type) ?? 0) + 1);
  }
  console.log("event type counts:");
  for (const [t, n] of [...typeCounts.entries()].sort()) {
    console.log(`  ${t}: ${n}`);
  }

  const submits = events.filter(
    (ev) => ev.type === "agent.custom_tool_use" && ev.name === "submit_findings",
  );
  console.log(`\nsubmit_findings calls: ${submits.length}`);
  for (const call of submits) {
    console.log(`  use_id=${call.id}`);
    if (call.input && typeof call.input === "object") {
      const obj = call.input as Record<string, unknown>;
      console.log("    input keys:", Object.keys(obj).join(", "));
      console.log("    policy_label:", obj.policy_label);
      console.log("    compliance_score:", obj.compliance_score);
      console.log("    risk_level:", obj.risk_level);
      const findings = obj.findings;
      console.log(
        "    findings count:",
        Array.isArray(findings) ? findings.length : "(not an array)",
      );
    }

    const result = events.find(
      (ev) =>
        ev.type === "user.custom_tool_result" &&
        ev.custom_tool_use_id === call.id,
    );
    if (!result) {
      console.log("    → no matching custom_tool_result yet");
    } else {
      console.log(`    → tool_result is_error=${result.is_error ?? false}`);
      const content = result.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<{ type?: string; text?: string }>) {
          if (block?.type === "text" && typeof block.text === "string") {
            console.log("    text:", block.text.slice(0, 500));
          }
        }
      }
    }
  }

  if (submits.length === 0) {
    console.log(
      "\nThe agent never called submit_findings. Check in the Anthropic console:",
    );
    console.log(
      "  1. Agent has a custom tool named exactly 'submit_findings' with the JSON schema from agent-config/cl.md.",
    );
    console.log(
      "  2. Agent's system prompt matches agent-config/cl.system.md (must contain the 'Reporte estructurado (obligatorio)' section).",
    );
    console.log("  3. The user explicitly asked the agent to AUDIT a policy.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
