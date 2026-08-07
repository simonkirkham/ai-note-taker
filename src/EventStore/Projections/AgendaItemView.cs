namespace EventStore.Projections;

// One agenda item composed onto NoteDetailView. Discussed is always false until 43-B (tick/untick);
// the field is present now so the view shape — and its DynamoDB mapping — is locked from 43-A and a
// later slice adds no new attribute. Position is capture order (the item's index at add time).
// 43-F: Derived marks a topic that was read out of the note body (a task-list line) rather than
// carried by a legacy AgendaItem* event. The header strip uses it to route a tick to the right
// place — a derived topic has no event stream behind it, so the pre-43-G API would 404 on it.
// Goes away with the legacy fold in 43-H, when every topic is derived.
public sealed record AgendaItemView(Guid ItemId, string Text, bool Discussed, int Position, bool Derived = false);
