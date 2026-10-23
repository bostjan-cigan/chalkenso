const HEADING_LINE_PATTERN = /^[^\d\n:][^:\n]*:\s*$/u;
const NUMBERED_PREFIX_PATTERN = /^\s*\d+[\.\)]\s*/u;
const BULLET_PREFIX_PATTERN = /^\s*[-*]\s+/u;

export type ParsedRosterMember = {
  fullName: string;
  position: number;
};

function normalizeRosterLine(line: string) {
  return line.replace(/\s+/g, ' ').trim();
}

function stripRosterPrefix(line: string) {
  return normalizeRosterLine(line)
    .replace(NUMBERED_PREFIX_PATTERN, '')
    .replace(BULLET_PREFIX_PATTERN, '')
    .trim();
}

export function parseGroupRoster(sourceRosterText: string) {
  const members: ParsedRosterMember[] = [];

  for (const rawLine of sourceRosterText.split('\n')) {
    const normalizedLine = normalizeRosterLine(rawLine);

    if (!normalizedLine || HEADING_LINE_PATTERN.test(normalizedLine)) {
      continue;
    }

    const fullName = stripRosterPrefix(normalizedLine);

    if (!fullName) {
      continue;
    }

    members.push({
      fullName,
      position: members.length + 1,
    });
  }

  return members;
}

/** One stored member, as the reconciler needs to see it. */
export type StoredRosterMember = {
  id: string;
  fullName: string;
  position: number;
};

export type RosterPlan = {
  /** Members that survive the edit, with the name/position the new roster gives them. */
  keep: Array<{
    id: string;
    currentName: string;
    currentPosition: number;
    fullName: string;
    position: number;
  }>;
  create: ParsedRosterMember[];
  removeIds: string[];
};

/** Names are matched case-insensitively, so fixing capitalisation is a rename, not a replacement. */
function matchKey(fullName: string) {
  return fullName.trim().toLocaleLowerCase();
}

/**
 * Works out the smallest set of changes that turns the stored roster into the submitted one, so a
 * group edit keeps the member rows it can. Member ids are the anchor for access links, feedback
 * attribution and lesson notes, so rebuilding the roster from scratch silently detaches all three —
 * which is why every edit has to be a diff rather than a delete-and-recreate.
 *
 * Members are matched by name, since the roster is free text and carries no ids. Two people with
 * the same name are matched in position order, and a genuine rename necessarily reads as one member
 * leaving and another arriving — there is nothing in the text to tie the two spellings together.
 */
export function planRosterUpdate(
  existing: StoredRosterMember[],
  desired: ParsedRosterMember[]
): RosterPlan {
  const available = new Map<string, StoredRosterMember[]>();

  for (const member of [...existing].sort((a, b) => a.position - b.position)) {
    const key = matchKey(member.fullName);
    const queue = available.get(key);

    if (queue) {
      queue.push(member);
    } else {
      available.set(key, [member]);
    }
  }

  const keep: RosterPlan['keep'] = [];
  const create: ParsedRosterMember[] = [];
  const matchedIds = new Set<string>();

  for (const wanted of desired) {
    const match = available.get(matchKey(wanted.fullName))?.shift();

    if (!match) {
      create.push(wanted);
      continue;
    }

    matchedIds.add(match.id);
    keep.push({
      id: match.id,
      currentName: match.fullName,
      currentPosition: match.position,
      fullName: wanted.fullName,
      position: wanted.position,
    });
  }

  return {
    keep,
    create,
    removeIds: existing.filter((member) => !matchedIds.has(member.id)).map((member) => member.id),
  };
}
