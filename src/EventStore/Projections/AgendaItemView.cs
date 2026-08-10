namespace EventStore.Projections;

// One agenda item composed onto NoteDetailView. Discussed is always false until 43-B (tick/untick);
// the field is present now so the view shape — and its DynamoDB mapping — is locked from 43-A and a
// later slice adds no new attribute. Position is capture order (the item's index at add time).
// 43-H2: EVERY topic is now read out of the note body, so Derived is always true. The field is
// retained rather than removed because it is a mapped DynamoDB attribute on an already-populated
// projection and a wire field the frontend reads — dropping it is a separate, breaking change, not
// a tidy-up. It no longer routes anything.
public sealed record AgendaItemView(Guid ItemId, string Text, bool Discussed, int Position, bool Derived = false);
