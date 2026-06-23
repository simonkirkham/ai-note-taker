using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteDetailProjection
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteDetailView(e.NoteId, string.Empty, string.Empty,
                    envelope.OccurredAt, envelope.OccurredAt, UserId: envelope.Metadata.UserId ?? "");
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEdited e:
                if (_items.TryGetValue(e.NoteId, out var cur))
                    _items[e.NoteId] = cur with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e:
                if (_items.TryGetValue(e.NoteId, out var cur2))
                    _items[e.NoteId] = cur2 with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDateSet e:
                if (_items.TryGetValue(e.NoteId, out var withDate))
                    _items[e.NoteId] = withDate with { Date = e.Date, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteTagged e:
                if (_items.TryGetValue(e.NoteId, out var tagged))
                {
                    // Lowercase + dedupe on fold (CHANGE-17) so legacy mixed-case tags normalise on rebuild.
                    var addTag = TagNormalization.Normalize(e.Tag);
                    var tags = (tagged.Tags ?? []).Contains(addTag) ? (tagged.Tags ?? []) : (tagged.Tags ?? []).Append(addTag).ToList().AsReadOnly();
                    _items[e.NoteId] = tagged with { Tags = tags, LastModifiedAt = envelope.OccurredAt };
                }
                break;
            case NoteUntagged e:
                if (_items.TryGetValue(e.NoteId, out var untagged))
                {
                    var removeTag = TagNormalization.Normalize(e.Tag);
                    _items[e.NoteId] = untagged with { Tags = (untagged.Tags ?? []).Where(t => t != removeTag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                }
                break;
            case NoteDeleted e:
                _items.Remove(e.NoteId);
                break;
            case NoteAssignedToWorkspace e:
                if (_items.TryGetValue(e.NoteId, out var assigned))
                    _items[e.NoteId] = assigned with { WorkspaceId = e.WorkspaceId.Value };
                break;
            case TranscriptionCompleted e:
                if (_items.TryGetValue(e.NoteId, out var transcribed))
                    _items[e.NoteId] = transcribed with { TranscriptText = e.TranscriptText };
                break;
            case RecordingUploaded e:
                if (_items.TryGetValue(e.NoteId, out var recorded))
                    _items[e.NoteId] = recorded with { RecordingAudioKey = e.AudioKey, LastModifiedAt = envelope.OccurredAt };
                break;
            case AnalysisSummaryRecorded e:
                if (_items.TryGetValue(e.NoteId, out var analysed))
                    _items[e.NoteId] = analysed with
                    {
                        Summary = e.Summary,
                        DiscussionPoints = e.DiscussionPoints,
                        Decisions = e.Decisions,
                        SummaryModelId = e.ModelId,
                        SummaryPromptVersion = e.PromptVersion,
                        LastModifiedAt = envelope.OccurredAt
                    };
                break;
            case InstructionResponsesRecorded e:
                if (_items.TryGetValue(e.NoteId, out var instructed))
                    _items[e.NoteId] = instructed with
                    {
                        InstructionResponses = e.Responses,
                        LastModifiedAt = envelope.OccurredAt
                    };
                break;
            default:
                break;
        }
    }

    public NoteDetailView? GetDetail(NoteId noteId) =>
        _items.TryGetValue(noteId, out var detail) ? detail : null;

    public IReadOnlyList<NoteDetailView> GetAllDetails() =>
        new List<NoteDetailView>(_items.Values).AsReadOnly();
}
