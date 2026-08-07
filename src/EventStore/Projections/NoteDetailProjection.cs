using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteDetailProjection
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    // 43-F: topics now come from the note body, but pre-43-F notes still carry AgendaItem* events.
    // Those fold here, apart from the view, so the composed Agenda can be recomputed whenever
    // EITHER input changes. Per-instance state is safe: every consumer (the live ProjectionUpdater
    // and ProjectionRebuildHandler alike) replays a whole stream through a fresh projection.
    // 43-H migrates the stragglers and this dictionary goes with the legacy fold.
    private readonly Dictionary<NoteId, List<AgendaItemView>> _legacyAgenda = new();

    private void Recompose(NoteId noteId)
    {
        if (!_items.TryGetValue(noteId, out var view)) return;
        var legacy = _legacyAgenda.TryGetValue(noteId, out var l) ? l : [];
        _items[noteId] = view with { Agenda = AgendaFromContent.Compose(noteId, view.Content, legacy) };
    }

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteDetailView(e.NoteId, string.Empty, string.Empty,
                    envelope.OccurredAt, envelope.OccurredAt, UserId: envelope.Metadata.UserId ?? "",
                    OwnerName: envelope.Metadata.UserName ?? "");
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEdited e:
                if (_items.TryGetValue(e.NoteId, out var cur))
                {
                    _items[e.NoteId] = cur with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
                break;
            case ContentEditedV2 e:
                if (_items.TryGetValue(e.NoteId, out var cur2))
                {
                    _items[e.NoteId] = cur2 with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
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
            // ── Legacy agenda events (pre-43-F). Folded into _legacyAgenda, never straight into the
            // view — the view's Agenda is always the composed union. Removed wholesale by 43-H.
            case AgendaItemAdded e:
                if (_items.TryGetValue(e.NoteId, out var withAgenda))
                {
                    Legacy(e.NoteId).Add(new AgendaItemView(e.ItemId, e.Text, false, e.Position));
                    _items[e.NoteId] = withAgenda with { LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
                break;
            case AgendaItemDiscussedSet e:
                if (_items.TryGetValue(e.NoteId, out var withTick))
                {
                    Replace(e.NoteId, e.ItemId, a => a with { Discussed = e.Discussed });
                    _items[e.NoteId] = withTick with { LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
                break;
            case AgendaItemTextEdited e:
                if (_items.TryGetValue(e.NoteId, out var withEdit))
                {
                    Replace(e.NoteId, e.ItemId, a => a with { Text = e.Text });
                    _items[e.NoteId] = withEdit with { LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
                break;
            case AgendaItemRemoved e:
                if (_items.TryGetValue(e.NoteId, out var withRemove))
                {
                    Legacy(e.NoteId).RemoveAll(a => a.ItemId == e.ItemId);
                    _items[e.NoteId] = withRemove with { LastModifiedAt = envelope.OccurredAt };
                    Recompose(e.NoteId);
                }
                break;
            case NoteDeleted e:
                _items.Remove(e.NoteId);
                _legacyAgenda.Remove(e.NoteId);
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
            case TranscriptionDiarized e:
                if (_items.TryGetValue(e.NoteId, out var diarized))
                    _items[e.NoteId] = diarized with
                    {
                        TranscriptText = e.Text,
                        TranscriptIsDiarized = true,
                        LastModifiedAt = envelope.OccurredAt
                    };
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

    private List<AgendaItemView> Legacy(NoteId noteId) =>
        _legacyAgenda.TryGetValue(noteId, out var l) ? l : _legacyAgenda[noteId] = [];

    private void Replace(NoteId noteId, Guid itemId, Func<AgendaItemView, AgendaItemView> update)
    {
        var legacy = Legacy(noteId);
        for (var i = 0; i < legacy.Count; i++)
            if (legacy[i].ItemId == itemId)
                legacy[i] = update(legacy[i]);
    }

    public NoteDetailView? GetDetail(NoteId noteId) =>
        _items.TryGetValue(noteId, out var detail) ? detail : null;

    public IReadOnlyList<NoteDetailView> GetAllDetails() =>
        new List<NoteDetailView>(_items.Values).AsReadOnly();
}
