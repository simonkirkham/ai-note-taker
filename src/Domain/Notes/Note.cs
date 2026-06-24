using Domain.Folders;
using Domain.Workspaces;

namespace Domain.Notes;

public sealed class Note : IAggregate
{
    bool _exists;
    bool _deleted;
    string? _title;
    string? _content;
    FolderId? _folderId;
    string? _calendarEventId;
    readonly HashSet<string> _tags = [];
    string? _transcriptText;
    string? _summary;
    WorkspaceId _workspaceId = WorkspaceId.Default;

    public bool Exists => _exists && !_deleted;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case NoteCreated:
                _exists = true;
                break;
            case NoteRenamed e:
                _title = e.NewTitle;
                break;
            case ContentEdited e:
                _content = e.NewContent;
                break;
            case ContentEditedV2 e:
                _content = e.NewContent;
                break;
            case NoteDeleted:
                _deleted = true;
                break;
            case NoteTagged e:
                _tags.Add(TagNormalization.Normalize(e.Tag));
                break;
            case NoteUntagged e:
                _tags.Remove(TagNormalization.Normalize(e.Tag));
                break;
            case NoteFiledInFolder e:
                _folderId = e.FolderId;
                break;
            case NoteUnfiled:
                _folderId = null;
                break;
            case NoteAssignedToWorkspace e:
                _workspaceId = e.WorkspaceId;
                break;
            case NoteLinkedToCalendarEvent e:
                _calendarEventId = e.CalendarEventId;
                break;
            case TranscriptionCompleted e:
                _transcriptText = e.TranscriptText;
                break;
            case TranscriptionDiarized e:
                _transcriptText = e.Text;
                break;
            case RecordingUploaded:
                break;
            case AnalysisSummaryRecorded e:
                _summary = e.Summary;
                break;
            case InstructionResponsesRecorded:
                break;
            case TagsSuggested:
            case TagsSuggestedV2:
            case ActionItemsSuggested:
            case ActionItemsSuggestedV2:
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            CreateNote cmd => HandleCreate(cmd),
            RenameNote cmd => HandleRename(cmd),
            EditContent cmd => HandleEditContent(cmd),
            DeleteNote cmd => HandleDelete(cmd),
            SetNoteDate cmd => HandleSetDate(cmd),
            TagNote cmd => HandleTagNote(cmd),
            UntagNote cmd => HandleUntagNote(cmd),
            MoveNoteToFolder cmd => HandleMoveToFolder(cmd),
            MoveNoteToWorkspace cmd => HandleMoveToWorkspace(cmd),
            UnfileNote cmd => HandleUnfile(cmd),
            LinkNoteToCalendarEvent cmd => HandleLinkToCalendarEvent(cmd),
            CompleteTranscription cmd => HandleCompleteTranscription(cmd),
            RecordDiarizedTranscription cmd => HandleRecordDiarizedTranscription(cmd),
            SaveRecording cmd => HandleSaveRecording(cmd),
            RecordTagSuggestions cmd => HandleRecordTagSuggestions(cmd),
            RecordActionItemSuggestions cmd => HandleRecordActionItemSuggestions(cmd),
            RecordAnalysisSummary cmd => HandleRecordAnalysisSummary(cmd),
            RecordInstructionResponses cmd => HandleRecordInstructionResponses(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    IReadOnlyList<IDomainEvent> HandleCreate(CreateNote cmd)
    {
        if (_exists)
            throw new InvalidOperationException($"Note {cmd.NoteId} already exists.");
        return [new NoteCreated(cmd.NoteId), new NoteAssignedToWorkspace(cmd.NoteId, cmd.WorkspaceId)];
    }

    IReadOnlyList<IDomainEvent> HandleRename(RenameNote cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (string.IsNullOrWhiteSpace(cmd.NewTitle))
            return [];
        if (cmd.NewTitle == _title)
            return [];
        return [new NoteRenamed(cmd.NoteId, cmd.NewTitle)];
    }

    IReadOnlyList<IDomainEvent> HandleEditContent(EditContent cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.Content == _content)
            return [];
        return [new ContentEdited(cmd.NoteId, cmd.Content)];
    }

    IReadOnlyList<IDomainEvent> HandleDelete(DeleteNote cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        return [new NoteDeleted(cmd.NoteId)];
    }

    IReadOnlyList<IDomainEvent> HandleSetDate(SetNoteDate cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        return [new NoteDateSet(cmd.NoteId, cmd.Date)];
    }

    IReadOnlyList<IDomainEvent> HandleTagNote(TagNote cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        var tag = TagNormalization.Normalize(cmd.Tag);
        if (_tags.Contains(tag))
            throw new InvalidOperationException($"Tag '{tag}' is already present on note {cmd.NoteId}.");
        return [new NoteTagged(cmd.NoteId, tag)];
    }

    IReadOnlyList<IDomainEvent> HandleUntagNote(UntagNote cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        var tag = TagNormalization.Normalize(cmd.Tag);
        if (!_tags.Contains(tag))
            throw new InvalidOperationException($"Tag '{tag}' is not present on note {cmd.NoteId}.");
        return [new NoteUntagged(cmd.NoteId, tag)];
    }

    IReadOnlyList<IDomainEvent> HandleMoveToFolder(MoveNoteToFolder cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.FolderId == _folderId)
            return [];
        return [new NoteFiledInFolder(cmd.NoteId, cmd.FolderId)];
    }

    IReadOnlyList<IDomainEvent> HandleMoveToWorkspace(MoveNoteToWorkspace cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.WorkspaceId == _workspaceId)
            return [];
        if (_folderId is not null)
            return [new NoteAssignedToWorkspace(cmd.NoteId, cmd.WorkspaceId), new NoteUnfiled(cmd.NoteId)];
        return [new NoteAssignedToWorkspace(cmd.NoteId, cmd.WorkspaceId)];
    }

    IReadOnlyList<IDomainEvent> HandleUnfile(UnfileNote cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (_folderId is null)
            return [];
        return [new NoteUnfiled(cmd.NoteId)];
    }

    IReadOnlyList<IDomainEvent> HandleLinkToCalendarEvent(LinkNoteToCalendarEvent cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (_calendarEventId is not null)
            throw new InvalidOperationException($"Note {cmd.NoteId} is already linked to a calendar event.");
        return [new NoteLinkedToCalendarEvent(cmd.NoteId, cmd.CalendarEventId, cmd.CalendarEventTitle,
            cmd.StartTime, cmd.EndTime, cmd.IsRecurring, cmd.RecurringSeriesId)];
    }

    IReadOnlyList<IDomainEvent> HandleCompleteTranscription(CompleteTranscription cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        return [new TranscriptionCompleted(cmd.NoteId, cmd.TranscriptText, cmd.DurationSeconds)];
    }

    IReadOnlyList<IDomainEvent> HandleSaveRecording(SaveRecording cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (string.IsNullOrWhiteSpace(cmd.AudioKey))
            throw new ArgumentException("Recording audio key must not be blank.", nameof(cmd));
        return [new RecordingUploaded(cmd.NoteId, cmd.AudioKey)];
    }

    IReadOnlyList<IDomainEvent> HandleRecordDiarizedTranscription(RecordDiarizedTranscription cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        // Never blank the note with a failed/empty diarization — the streamed transcript stays.
        if (string.IsNullOrWhiteSpace(cmd.Text))
            throw new ArgumentException("Diarized transcript text must not be blank.", nameof(cmd));
        return [new TranscriptionDiarized(cmd.NoteId, cmd.Text, cmd.SpeakerCount, cmd.JobId, cmd.SourceAudioKey)];
    }

    IReadOnlyList<IDomainEvent> HandleRecordTagSuggestions(RecordTagSuggestions cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.Tags.Count == 0)
            return [];
        return [new TagsSuggestedV2(cmd.NoteId, cmd.Tags, cmd.ModelId, cmd.PromptVersion)];
    }

    IReadOnlyList<IDomainEvent> HandleRecordActionItemSuggestions(RecordActionItemSuggestions cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.ActionItemIds.Count == 0)
            return [];
        return [new ActionItemsSuggestedV2(cmd.NoteId, cmd.ActionItemIds, cmd.ModelId, cmd.PromptVersion)];
    }

    IReadOnlyList<IDomainEvent> HandleRecordAnalysisSummary(RecordAnalysisSummary cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        return [new AnalysisSummaryRecorded(cmd.NoteId, cmd.Summary, cmd.DiscussionPoints, cmd.Decisions,
            cmd.ModelId, cmd.PromptVersion)];
    }

    IReadOnlyList<IDomainEvent> HandleRecordInstructionResponses(RecordInstructionResponses cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        // Always emits (even an empty list) so a re-run that produced no responses clears stale ones —
        // a full snapshot where latest wins, exactly like RecordAnalysisSummary. The analysis handler
        // only issues this command when there is something to record or clear.
        return [new InstructionResponsesRecorded(cmd.NoteId, cmd.Responses, cmd.ModelId, cmd.PromptVersion)];
    }
}
