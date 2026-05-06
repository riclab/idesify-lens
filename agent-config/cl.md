# Agent config — Chile — Ley 21.719

The full **system prompt** is in `agent-config/cl.system.md` (raw, no markdown wrapper) — open that file, copy its entire contents, and paste it into the Anthropic console for the agent assigned to `ANTHROPIC_AGENT_ID_CL`.

Then add each tool below as a custom tool on the same agent.

## Tools

### search_policy_url

```json
{
  "name": "search_policy_url",
  "description": "Search the web for a company's privacy policy URL. Use this when the user mentions a company by name without providing a URL. Returns up to 5 candidate URLs with snippets.",
  "input_schema": {
    "type": "object",
    "properties": {
      "company_name": {
        "type": "string",
        "description": "Name of the company whose privacy policy to find (e.g. 'Spotify', 'Falabella')."
      }
    },
    "required": [
      "company_name"
    ]
  }
}
```

### read_url

```json
{
  "name": "read_url",
  "description": "Fetch the cleaned-up text content of a public web page (uses Jina Reader). Use this to read a privacy policy URL the user provided or that you found via search_policy_url. Returns markdown.",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "Public HTTP(S) URL to fetch."
      }
    },
    "required": [
      "url"
    ]
  }
}
```
