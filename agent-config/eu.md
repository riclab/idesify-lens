# Agent config — European Union — GDPR

The full **system prompt** is in `agent-config/eu.system.md` (raw, no markdown wrapper) — open that file, copy its entire contents, and paste it into the Anthropic console for the agent assigned to `ANTHROPIC_AGENT_ID_EU`.

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

### search_dpo_contact

```json
{
  "name": "search_dpo_contact",
  "description": "Search the web for a company's Data Protection Officer / privacy contact email. Use this when the user wants to exercise data subject rights and you don't yet have a recipient address. Returns up to 6 candidate hits with snippets — pick the most authoritative one (the company's own privacy/legal page).",
  "input_schema": {
    "type": "object",
    "properties": {
      "company_name": {
        "type": "string",
        "description": "Name of the company whose DPO/privacy contact to find."
      }
    },
    "required": [
      "company_name"
    ]
  }
}
```

### draft_legal_email

```json
{
  "name": "draft_legal_email",
  "description": "Generate a formal, jurisdiction-correct email exercising a data subject / consumer right against a company. Returns a ready-to-send To/Subject/body block. Always confirm the recipient address with the user (typically obtained from search_dpo_contact) before drafting.",
  "input_schema": {
    "type": "object",
    "properties": {
      "jurisdiction": {
        "type": "string",
        "enum": [
          "cl",
          "eu",
          "us-ca"
        ],
        "description": "Legal jurisdiction whose template to use."
      },
      "right": {
        "type": "string",
        "enum": [
          "access",
          "rectification",
          "deletion",
          "opposition",
          "portability",
          "restriction",
          "opt_out_sale",
          "limit_sensitive"
        ],
        "description": "Which right to exercise. CL supports access/rectification/deletion/opposition/portability. EU adds restriction. US-CA supports access/deletion/rectification/opt_out_sale/limit_sensitive."
      },
      "recipient_email": {
        "type": "string",
        "description": "Email address of the DPO / privacy contact at the company."
      },
      "recipient_name": {
        "type": "string",
        "description": "Optional name of the DPO / privacy contact for the salutation."
      },
      "company_name": {
        "type": "string",
        "description": "Name of the company being addressed."
      },
      "requester_name": {
        "type": "string",
        "description": "Full name of the data subject / consumer making the request."
      },
      "requester_id": {
        "type": "string",
        "description": "Optional national identifier (e.g. RUT for Chile) if the user provided one."
      },
      "subject_data": {
        "type": "string",
        "description": "Optional 1–2 sentence description of which data or processing activities the request covers. If omitted, the email contains a placeholder for the user to fill in."
      }
    },
    "required": [
      "jurisdiction",
      "right",
      "recipient_email",
      "company_name",
      "requester_name"
    ]
  }
}
```
