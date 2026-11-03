/** The slide identities a group owns; independent of its script, artwork and room participants. */
export interface GroupLayout { id: string; slides: readonly { id: string }[] }

/** A split keeps the original speaker on both parts; a join takes the first assigned part's speaker. */
export function carriedSpeakers(before: readonly GroupLayout[], after: readonly GroupLayout[], assignments: Readonly<Record<string, string>>): Record<string, string> {
  const from = new Map(before.flatMap((g) => g.slides.map((s) => [s.id, assignments[g.id]] as const)));
  const carried: Record<string, string> = {};
  for (const g of after) {
    if (assignments[g.id]) continue;
    const who = g.slides.map((s) => from.get(s.id)).find((p) => p !== undefined);
    if (who) carried[g.id] = who;
  }
  return carried;
}
