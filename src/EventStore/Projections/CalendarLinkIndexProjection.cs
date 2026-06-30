using Domain.Notes;

namespace EventStore.Projections;

public sealed class CalendarLinkIndexProjection
{
    private readonly Dictionary<string, CalendarLinkView> _byCalendarEventId = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteLinkedToCalendarEvent e:
                _byCalendarEventId[e.CalendarEventId] = new CalendarLinkView(
                    e.CalendarEventId, e.NoteId.Value.ToString(), e.RecurringSeriesId,
                    e.StartTime, e.EndTime, e.CalendarEventTitle, envelope.Metadata.UserId ?? "");
                break;
            case NoteUnlinkedFromCalendarEvent e:
                // Ownership-checked to mirror the live projector: only drop the row if this note still
                // owns it (ordered replay makes this always true here, but the guard documents intent
                // and stays correct if event order ever changes).
                if (_byCalendarEventId.TryGetValue(e.PreviousCalendarEventId, out var owned)
                    && owned.NoteId == e.NoteId.Value.ToString())
                    _byCalendarEventId.Remove(e.PreviousCalendarEventId);
                break;
            case NoteDeleted e:
                var noteId = e.NoteId.Value.ToString();
                foreach (var key in _byCalendarEventId
                             .Where(kvp => kvp.Value.NoteId == noteId)
                             .Select(kvp => kvp.Key)
                             .ToList())
                    _byCalendarEventId.Remove(key);
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<CalendarLinkView> GetAll() => _byCalendarEventId.Values.ToList().AsReadOnly();
}
