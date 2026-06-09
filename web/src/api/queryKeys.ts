export const keys = {
  todos: ["todos"] as const,
  folders: ["folders"] as const,
  noteCards: ["noteCards"] as const,
  tags: ["tags"] as const,
  note: (id: string) => ["note", id] as const,
  actions: (noteId: string) => ["actions", noteId] as const,
  meetings: (date: string) => ["meetings", date] as const,
} as const;
