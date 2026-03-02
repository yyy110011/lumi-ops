/**
 * Shared parse/serialize utilities for mission template markdown files.
 *
 * Format:
 *   ---
 *   name: <template-name>
 *   ---
 *
 *   ## Task
 *   <task content>
 *
 *   ## Rules
 *   <rules content>
 *
 *   ## Instructions
 *   <instructions content>
 *
 * These are pure functions with no vscode dependency, so they remain easily testable.
 */

export interface MissionTemplateFields {
  name: string;
  task: string;
  rules: string;
  instructions: string;
}

/** Parse mission template markdown into structured fields. */
export function parseMissionTemplate(content: string): MissionTemplateFields {
  let body = content;
  let name = '';

  // Strip YAML frontmatter and extract name
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (fmMatch) {
    body = content.substring(fmMatch[0].length);
    const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
    if (nameMatch) { name = nameMatch[1].trim(); }
  }

  // Parse sections by ## headers
  const sections: Record<string, string> = {};
  const sectionRegex = /^## (.+)$/gm;
  let match: RegExpExecArray | null;
  const matches: { header: string; start: number }[] = [];

  while ((match = sectionRegex.exec(body)) !== null) {
    matches.push({ header: match[1].trim().toLowerCase(), start: match.index + match[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? body.lastIndexOf('\n## ', matches[i + 1].start) : body.length;
    sections[matches[i].header] = body.substring(matches[i].start, end).trim();
  }

  return {
    name,
    task: sections['task'] || '',
    rules: sections['rules'] || '',
    instructions: sections['instructions'] || '',
  };
}

/** Serialize structured fields back to mission template markdown. */
export function serializeMissionTemplate(fields: MissionTemplateFields): string {
  const parts: string[] = [];
  parts.push('---');
  parts.push(`name: ${fields.name}`);
  parts.push('---');
  parts.push('');
  parts.push('## Task');
  parts.push(fields.task || '');
  parts.push('');
  parts.push('## Rules');
  parts.push(fields.rules || '');
  parts.push('');
  parts.push('## Instructions');
  parts.push(fields.instructions || '');
  parts.push('');
  return parts.join('\n');
}
