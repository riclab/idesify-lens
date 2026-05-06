import { getAnthropic } from "./anthropic";
import type { JurisdictionId } from "./laws";

const ENV_BY_JURISDICTION: Record<JurisdictionId, string> = {
  cl: "ANTHROPIC_AGENT_ID_CL",
  eu: "ANTHROPIC_AGENT_ID_EU",
  "us-ca": "ANTHROPIC_AGENT_ID_US_CA",
};

export function getManagedAgentConfig(jurisdiction: JurisdictionId): {
  agentId: string;
  environmentId: string;
} {
  const envVar = ENV_BY_JURISDICTION[jurisdiction];
  const agentId = process.env[envVar];
  const environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!agentId || !environmentId) {
    throw new Error(
      `${envVar} and ANTHROPIC_ENVIRONMENT_ID must be set to create managed agent sessions`,
    );
  }
  return { agentId, environmentId };
}

export async function createManagedAgentSession(jurisdiction: JurisdictionId) {
  const client = getAnthropic();
  const { agentId, environmentId } = getManagedAgentConfig(jurisdiction);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
  });
  return {
    anthropicSessionId: session.id,
    agentId: session.agent.id,
    environmentId: session.environment_id,
  };
}
