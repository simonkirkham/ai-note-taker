namespace EventStore.Projections;

// One agenda item composed onto NoteDetailView. Discussed is always false until 43-B (tick/untick);
// the field is present now so the view shape — and its DynamoDB mapping — is locked from 43-A and a
// later slice adds no new attribute. Position is capture order (the item's index at add time).
public sealed record AgendaItemView(Guid ItemId, string Text, bool Discussed, int Position);
