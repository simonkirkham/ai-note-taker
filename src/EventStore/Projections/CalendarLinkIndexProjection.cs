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
