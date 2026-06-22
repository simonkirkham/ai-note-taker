import { useMemo } from 'react'
import type { TagIndexEntry } from '../api/tags'

export interface SuggestionItem {
  tag: string
  heading?: 'Related' | 'Common'
}

export function useTagSuggestions(
  input: string,
  allTags: TagIndexEntry[],
  appliedTags: string[],
): SuggestionItem[] {
  return useMemo(() => {
    // Tags are case-insensitive (CHANGE-17): compare against applied tags lowercased so a
    // legacy mixed-case applied tag (pre-rebuild) is still filtered out of the suggestions.
    const applied = new Set(appliedTags.map((t) => t.toLowerCase()))
    const available = allTags.filter((e) => !applied.has(e.tag.toLowerCase()))
    const q = input.trim().toLowerCase()

    if (q) {
      const prefix = available
        .filter((e) => e.tag.toLowerCase().startsWith(q))
        .sort((a, b) => b.noteCount - a.noteCount)

      const substring = available
        .filter((e) => !e.tag.toLowerCase().startsWith(q) && e.tag.toLowerCase().includes(q))
        .sort((a, b) => b.noteCount - a.noteCount)

      return [...prefix, ...substring].map((e) => ({ tag: e.tag }))
    }

    const result: SuggestionItem[] = []

    const relatedTags = new Set<string>()

    if (appliedTags.length > 0) {
      const appliedNoteIds = new Set(
        appliedTags.flatMap(
          (tag) => allTags.find((e) => e.tag.toLowerCase() === tag.toLowerCase())?.noteIds ?? [],
        ),
      )

      const related = available
        .map((e) => ({ tag: e.tag, overlap: e.noteIds.filter((id) => appliedNoteIds.has(id)).length }))
        .filter((e) => e.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 5)

      if (related.length > 0) {
        result.push({ tag: related[0].tag, heading: 'Related' })
        result.push(...related.slice(1).map((e) => ({ tag: e.tag })))
        related.forEach((e) => relatedTags.add(e.tag))
      }
    }

    const common = available
      .filter((e) => !relatedTags.has(e.tag))
      .sort((a, b) => b.noteCount - a.noteCount)
      .slice(0, 8)

    if (common.length > 0) {
      result.push({ tag: common[0].tag, heading: 'Common' })
      result.push(...common.slice(1).map((e) => ({ tag: e.tag })))
    }

    return result
  }, [input, allTags, appliedTags])
}
