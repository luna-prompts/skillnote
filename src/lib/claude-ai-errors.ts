/**
 * Human-friendly presentation of claude.ai connector sync errors.
 *
 * Raw errors reach SkillNote in several shapes: a claude.ai JSON error body,
 * an HTTP-status dump built by the extension, or a plain string. This turns
 * any of them into a tight human summary (for the headline) plus the raw
 * detail (for a "show details" affordance). Pure + framework-free so it's
 * shared by the connector page and the activity feed, and unit-testable.
 */
export function friendlyIntegrationError(raw: string): { summary: string; detail: string | null } {
  const trimmed = (raw ?? '').trim()
  // Pull a nested `"message": "..."` out of an embedded JSON error body.
  // Tolerate escaped quotes inside the message (e.g. {"message":"Skill \"x\"
  // already exists"}) — a plain [^"]+ would truncate at the first inner quote.
  const msgMatch = trimmed.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const apiMsg = msgMatch?.[1]
  const statusMatch = trimmed.match(/\breturned\s+(\d{3})\b/)

  let summary: string
  if (/already in use|name.*(taken|exists)/i.test(trimmed)) {
    summary = 'A skill with that name already exists on claude.ai and can’t be overwritten.'
  } else if (/invalid authorization|not authorized|unauthorized|permission denied|forbidden/i.test(trimmed)) {
    // Note: match "permission denied"/"forbidden", NOT a bare "permission" —
    // an unrelated SkillNote-side "you don't have permission" message must not
    // be misattributed to claude.ai.
    summary = 'claude.ai rejected the request — this account may not have permission for that action.'
  } else if (/session (expired|not active)|sign ?in|logged out/i.test(trimmed)) {
    summary = 'Your claude.ai session ended. Sign back in and sync resumes automatically.'
  } else if (/endpoint changed|unexpected (response|shape)/i.test(trimmed)) {
    summary = 'claude.ai changed its interface — update the SkillNote extension to restore sync.'
  } else if (apiMsg) {
    summary = apiMsg
  } else if (statusMatch) {
    summary = `claude.ai returned an error (HTTP ${statusMatch[1]}).`
  } else {
    summary = trimmed
  }

  // Keep the summary tight; never dump a wall of JSON as the headline.
  if (summary.length > 160) summary = summary.slice(0, 157).trimEnd() + '…'
  const detail = trimmed && trimmed !== summary ? trimmed : null
  return { summary, detail }
}
