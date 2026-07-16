using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class EditContentSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void EditsContentWhenNoteExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new EditContent(Id, "Today we discussed the roadmap."))
            .Then(new ContentEdited(Id, "Today we discussed the roadmap."));
    }

    [Fact]
    public void RejectsEditWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new EditContent(Id, "Some content"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void ProducesNoEventWhenContentIsUnchanged()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "Some content"))
            .When(new EditContent(Id, "Some content"))
            .Then();
    }

    // BUG-47: the caller edited a stale/empty view of a note that actually has content — the base
    // hash it carries no longer matches the current content, so the edit would silently overwrite
    // real content. Reject it as a terminal conflict rather than persisting the overwrite.
    [Fact]
    public void RejectsEditWhenBaseContentHashIsStale()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "The full original meeting note."))
            .When(new EditContent(Id, "fragment the user retyped",
                ExpectedBaseContentHash: NoteContentHash.Compute("")))
            .ThenThrows<StaleContentEditException>();
    }

    // A legitimate edit: the caller loaded the current content, so its base hash matches. Allowed.
    [Fact]
    public void AllowsEditWhenBaseContentHashMatches()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "The full original meeting note."))
            .When(new EditContent(Id, "The full original meeting note. Plus a new line.",
                ExpectedBaseContentHash: NoteContentHash.Compute("The full original meeting note.")))
            .Then(new ContentEdited(Id, "The full original meeting note. Plus a new line."));
    }

    // The user's concern made explicit: a deliberate delete-all still works, because the base hash
    // matches the content they saw and cleared. The guard blocks stale overwrites, not real deletes.
    [Fact]
    public void AllowsDeleteAllWhenBaseContentHashMatches()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "The full original meeting note."))
            .When(new EditContent(Id, "",
                ExpectedBaseContentHash: NoteContentHash.Compute("The full original meeting note.")))
            .Then(new ContentEdited(Id, ""));
    }

    // First-ever content: the note has none, so the caller's base hash is the hash of empty. Allowed.
    [Fact]
    public void AllowsFirstContentWhenBaseHashIsEmpty()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new EditContent(Id, "First content typed into a blank note.",
                ExpectedBaseContentHash: NoteContentHash.Compute("")))
            .Then(new ContentEdited(Id, "First content typed into a blank note."));
    }

    // Backward compatibility: callers that don't opt in (MCP edit_note, the analysis Lambda) send no
    // base hash, so the guard is skipped and their content writes behave exactly as before.
    [Fact]
    public void SkipsGuardWhenNoBaseHashProvided()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "The full original meeting note."))
            .When(new EditContent(Id, "fragment", ExpectedBaseContentHash: null))
            .Then(new ContentEdited(Id, "fragment"));
    }

    // A matching base hash on unchanged content is still a no-op — the guard passes, then the
    // existing unchanged-content short-circuit emits nothing.
    [Fact]
    public void ProducesNoEventWhenContentUnchangedAndBaseHashMatches()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "Same content"))
            .When(new EditContent(Id, "Same content",
                ExpectedBaseContentHash: NoteContentHash.Compute("Same content")))
            .Then();
    }
}
