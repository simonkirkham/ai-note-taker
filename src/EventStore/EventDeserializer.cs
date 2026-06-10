using System.Text.Json;
using Domain;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;
using Domain.Todos;
using Domain.Workspaces;

namespace EventStore;

public static class EventDeserializer
{
    public static IDomainEvent Deserialize(EventEnvelope envelope) => (envelope.EventType, envelope.EventVersion) switch
    {
        (nameof(NoteCreated), _) => JsonSerializer.Deserialize<NoteCreated>(envelope.Payload)!,
        (nameof(NoteRenamed), _) => JsonSerializer.Deserialize<NoteRenamed>(envelope.Payload)!,
        (nameof(ContentEdited), 1) => JsonSerializer.Deserialize<ContentEdited>(envelope.Payload)!,
        (nameof(ContentEdited), 2) => JsonSerializer.Deserialize<ContentEditedV2>(envelope.Payload)!,
        (nameof(NoteDeleted), _) => JsonSerializer.Deserialize<NoteDeleted>(envelope.Payload)!,
        (nameof(NoteDateSet), _) => JsonSerializer.Deserialize<NoteDateSet>(envelope.Payload)!,
        (nameof(NoteTagged), _) => JsonSerializer.Deserialize<NoteTagged>(envelope.Payload)!,
        (nameof(NoteUntagged), _) => JsonSerializer.Deserialize<NoteUntagged>(envelope.Payload)!,
        (nameof(TagsSuggested), 1) => JsonSerializer.Deserialize<TagsSuggested>(envelope.Payload)!,
        (nameof(TagsSuggested), 2) => JsonSerializer.Deserialize<TagsSuggestedV2>(envelope.Payload)!,
        (nameof(ActionItemsSuggested), 1) => JsonSerializer.Deserialize<ActionItemsSuggested>(envelope.Payload)!,
        (nameof(ActionItemsSuggested), 2) => JsonSerializer.Deserialize<ActionItemsSuggestedV2>(envelope.Payload)!,
        (nameof(ActionItemAdded), _) => JsonSerializer.Deserialize<ActionItemAdded>(envelope.Payload)!,
        (nameof(ActionItemCompleted), _) => JsonSerializer.Deserialize<ActionItemCompleted>(envelope.Payload)!,
        (nameof(ActionItemReopened), _) => JsonSerializer.Deserialize<ActionItemReopened>(envelope.Payload)!,
        (nameof(ActionItemDeleted), _) => JsonSerializer.Deserialize<ActionItemDeleted>(envelope.Payload)!,
        (nameof(FolderCreated), _) => JsonSerializer.Deserialize<FolderCreated>(envelope.Payload)!,
        (nameof(FolderRenamed), _) => JsonSerializer.Deserialize<FolderRenamed>(envelope.Payload)!,
        (nameof(FolderDeleted), _) => JsonSerializer.Deserialize<FolderDeleted>(envelope.Payload)!,
        (nameof(FolderMoved), _) => JsonSerializer.Deserialize<FolderMoved>(envelope.Payload)!,
        (nameof(NoteFiledInFolder), _) => JsonSerializer.Deserialize<NoteFiledInFolder>(envelope.Payload)!,
        (nameof(NoteUnfiled), _) => JsonSerializer.Deserialize<NoteUnfiled>(envelope.Payload)!,
        (nameof(NoteAssignedToWorkspace), _) => JsonSerializer.Deserialize<NoteAssignedToWorkspace>(envelope.Payload)!,
        (nameof(NoteLinkedToCalendarEvent), _) => JsonSerializer.Deserialize<NoteLinkedToCalendarEvent>(envelope.Payload)!,
        (nameof(TranscriptionCompleted), _) => JsonSerializer.Deserialize<TranscriptionCompleted>(envelope.Payload)!,
        (nameof(AnalysisSummaryRecorded), _) => JsonSerializer.Deserialize<AnalysisSummaryRecorded>(envelope.Payload)!,
        (nameof(TodoAdded), _) => JsonSerializer.Deserialize<TodoAdded>(envelope.Payload)!,
        (nameof(TodoCompleted), _) => JsonSerializer.Deserialize<TodoCompleted>(envelope.Payload)!,
        (nameof(TodoReopened), _) => JsonSerializer.Deserialize<TodoReopened>(envelope.Payload)!,
        (nameof(TodoDeleted), _) => JsonSerializer.Deserialize<TodoDeleted>(envelope.Payload)!,
        (nameof(WorkspaceCreated), _) => JsonSerializer.Deserialize<WorkspaceCreated>(envelope.Payload)!,
        (nameof(WorkspaceRenamed), _) => JsonSerializer.Deserialize<WorkspaceRenamed>(envelope.Payload)!,
        (nameof(WorkspaceDeleted), _) => JsonSerializer.Deserialize<WorkspaceDeleted>(envelope.Payload)!,
        _ => throw new InvalidOperationException($"Unknown event type/version: {envelope.EventType} v{envelope.EventVersion}")
    };
}
