using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

// Phase 43-F — the agenda becomes a READING of the note body. Every task-list line in the content
// is a topic; the tick is `- [x]` in the markdown, so ticking appends ContentEdited rather than an
// agenda event. This reverses 43-A's "agenda is separate data" decision (notes are running prose,
// not a section per topic, so a heading-anchored tick could never fire).
//
// STRANGLER: 43-F derives from content AND keeps folding the legacy AgendaItem* events, union-ed,
// so the 9 notes that already carry agenda events do not regress. 43-H migrates them and only then
// drops the legacy fold. Do not collapse these two paths early.
public sealed class AgendaFromBodySpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    private static (NoteDetailProjection Projection, NoteId NoteId) NoteWith(string content)
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var projection = new NoteDetailProjection();
        projection.Handle(Envelope(stream, 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(noteId))));
        projection.Handle(Envelope(stream, 2, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, content))));
        return (projection, noteId);
    }

    private static IReadOnlyList<AgendaItemView> AgendaOf(NoteDetailProjection p, NoteId id) =>
        p.GetDetail(id)?.Agenda ?? [];

    [Fact]
    public void A_checklist_line_in_the_body_is_a_topic()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)\n- [ ] Hiring plan\n\nRob says cloud spend is 8% over.");

        var agenda = AgendaOf(p, id);
        Assert.Equal(["Budget (Q3)", "Hiring plan"], agenda.Select(a => a.Text));
        Assert.All(agenda, a => Assert.False(a.Discussed));
    }

    [Fact]
    public void A_ticked_checklist_line_is_a_covered_topic()
    {
        var (p, id) = NoteWith("- [x] Budget (Q3)\n- [ ] Hiring plan\n- [ ] On-call rotation");

        var agenda = AgendaOf(p, id);
        Assert.Equal(3, agenda.Count);
        Assert.True(agenda.Single(a => a.Text == "Budget (Q3)").Discussed);
        Assert.Equal(1, agenda.Count(a => a.Discussed));
    }

    [Fact]
    public void Topics_are_in_document_order()
    {
        var (p, id) = NoteWith("- [ ] First\n- [ ] Second\n- [ ] Third");

        var agenda = AgendaOf(p, id);
        Assert.Equal([0, 1, 2], agenda.Select(a => a.Position));
        Assert.Equal(["First", "Second", "Third"], agenda.Select(a => a.Text));
    }

    [Fact]
    public void Editing_the_body_to_add_a_line_grows_the_agenda()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)\n- [ ] Hiring plan");
        Assert.Equal(2, AgendaOf(p, id).Count);

        p.Handle(Envelope($"note#{id.Value}", 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(id, "- [ ] Budget (Q3)\n- [ ] Hiring plan\n- [ ] Renewals"))));

        Assert.Equal(["Budget (Q3)", "Hiring plan", "Renewals"], AgendaOf(p, id).Select(a => a.Text));
    }

    [Fact]
    public void Unticking_in_the_body_lowers_the_covered_count()
    {
        var (p, id) = NoteWith("- [x] Budget (Q3)\n- [ ] Hiring plan");
        Assert.Equal(1, AgendaOf(p, id).Count(a => a.Discussed));

        p.Handle(Envelope($"note#{id.Value}", 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(id, "- [ ] Budget (Q3)\n- [ ] Hiring plan"))));

        Assert.Equal(0, AgendaOf(p, id).Count(a => a.Discussed));
    }

    [Fact]
    public void Ordinary_prose_and_bullets_are_not_topics()
    {
        var (p, id) = NoteWith("Rob says cloud spend is 8% over.\n\n- a plain bullet\n- another\n\n## A heading");

        Assert.Empty(AgendaOf(p, id));
    }

    [Fact]
    public void A_note_with_no_content_has_no_topics()
    {
        var (p, id) = NoteWith("");

        Assert.Empty(AgendaOf(p, id));
    }

    [Fact]
    public void Nested_checklist_lines_count_as_topics()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)\n  - [ ] Cloud spend\n- [ ] Hiring plan");

        Assert.Equal(["Budget (Q3)", "Cloud spend", "Hiring plan"], AgendaOf(p, id).Select(a => a.Text));
    }

    [Fact]
    public void The_same_topic_text_keeps_its_id_when_ticked()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)");
        var before = AgendaOf(p, id).Single().ItemId;

        p.Handle(Envelope($"note#{id.Value}", 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(id, "- [x] Budget (Q3)"))));

        var after = AgendaOf(p, id).Single();
        Assert.Equal(before, after.ItemId);
        Assert.True(after.Discussed);
    }

    [Fact]
    public void A_topic_read_from_the_body_is_marked_derived()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)");

        Assert.True(Assert.Single(AgendaOf(p, id)).Derived);
    }

    [Fact]
    public void Task_lines_inside_a_code_fence_are_not_topics()
    {
        var (p, id) = NoteWith("Runbook:\n\n```\n- [ ] npm ci\n- [x] deploy\n```\n\n- [ ] Real topic");

        Assert.Equal("Real topic", Assert.Single(AgendaOf(p, id)).Text);
    }

    [Fact]
    public void A_tilde_fence_also_hides_task_lines()
    {
        var (p, id) = NoteWith("~~~\n- [ ] not a topic\n~~~\n\n- [ ] Budget (Q3)");

        Assert.Equal("Budget (Q3)", Assert.Single(AgendaOf(p, id)).Text);
    }

    [Fact]
    public void An_unclosed_fence_swallows_the_rest_of_the_note()
    {
        // Matches how a markdown renderer treats it — better than leaking code as topics.
        var (p, id) = NoteWith("```\n- [ ] still code");

        Assert.Empty(AgendaOf(p, id));
    }

    [Fact]
    public void Two_lines_with_the_same_text_are_two_topics_with_different_ids()
    {
        var (p, id) = NoteWith("- [ ] Follow up\n- [x] Follow up");

        var agenda = AgendaOf(p, id);
        Assert.Equal(2, agenda.Count);
        Assert.NotEqual(agenda[0].ItemId, agenda[1].ItemId);
        Assert.False(agenda[0].Discussed);
        Assert.True(agenda[1].Discussed);
    }

    [Fact]
    public void Markdown_escapes_are_not_shown_in_the_topic_text()
    {
        // prosemirror-markdown escapes ` * \ ~ [ ] _ when it serialises inline text, so the raw
        // body of a line the user typed as "Review Q3 [draft]" carries backslashes.
        var (p, id) = NoteWith("- [ ] Review Q3 \\[draft\\]");

        Assert.Equal("Review Q3 [draft]", Assert.Single(AgendaOf(p, id)).Text);
    }

    [Fact]
    public void An_id_is_unchanged_by_a_topic_inserted_above_it()
    {
        var (p, id) = NoteWith("- [ ] Budget (Q3)\n- [ ] Hiring plan");
        var hiringBefore = AgendaOf(p, id).Single(a => a.Text == "Hiring plan").ItemId;

        p.Handle(Envelope($"note#{id.Value}", 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(id, "- [ ] Renewals\n- [ ] Budget (Q3)\n- [ ] Hiring plan"))));

        Assert.Equal(hiringBefore, AgendaOf(p, id).Single(a => a.Text == "Hiring plan").ItemId);
    }

    // ── Strangler: legacy agenda events keep working until 43-H migrates them ──

    [Fact]
    public void A_legacy_topic_is_not_marked_derived()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Budget (Q3)", 0))));

        // The header keeps its add/tick/edit/remove controls for these until 43-H migrates them.
        Assert.False(Assert.Single(AgendaOf(p, noteId)).Derived);
    }

    [Fact]
    public void Legacy_agenda_items_still_appear_when_the_body_has_no_checklist()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var itemId = Guid.NewGuid();
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, itemId, "Budget (Q3)", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "Just running prose, no checklist."))));

        var agenda = AgendaOf(p, noteId);
        Assert.Equal("Budget (Q3)", Assert.Single(agenda).Text);
        Assert.Equal(itemId, agenda[0].ItemId);
    }

    [Fact]
    public void Legacy_ticked_state_survives_a_body_edit()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var itemId = Guid.NewGuid();
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, itemId, "Budget (Q3)", 0))));
        p.Handle(Envelope(stream, 3, nameof(AgendaItemDiscussedSet),
            JsonSerializer.Serialize(new AgendaItemDiscussedSet(noteId, itemId, true))));
        p.Handle(Envelope(stream, 4, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "Some notes typed afterwards."))));

        Assert.True(Assert.Single(AgendaOf(p, noteId)).Discussed);
    }

    [Fact]
    public void A_body_line_matching_a_legacy_item_is_not_listed_twice()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var itemId = Guid.NewGuid();
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, itemId, "Budget (Q3)", 0))));
        p.Handle(Envelope(stream, 3, nameof(AgendaItemDiscussedSet),
            JsonSerializer.Serialize(new AgendaItemDiscussedSet(noteId, itemId, true))));
        // 43-H will write exactly this line into the body for the migrated notes.
        p.Handle(Envelope(stream, 4, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [x] Budget (Q3)"))));

        var agenda = AgendaOf(p, noteId);
        Assert.Equal("Budget (Q3)", Assert.Single(agenda).Text);
        Assert.True(agenda[0].Discussed);
    }

    [Fact]
    public void A_legacy_item_matches_its_migrated_body_line_even_once_escaped()
    {
        // 43-H writes the topic text into the body unescaped; the editor re-serialises it escaped
        // on the user's next save. Dedup must survive that or the topic is listed twice.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Review Q3 [draft]", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] Review Q3 \\[draft\\]"))));

        Assert.Equal("Review Q3 [draft]", Assert.Single(AgendaOf(p, noteId)).Text);
    }

    [Fact]
    public void A_legacy_item_matches_its_migrated_body_line_once_the_user_emphasises_it()
    {
        // 43-H's explicit criterion. The user bolds the migrated line; it is still the same topic,
        // so it must not double-list. MatchKey is the single definition both the union and the
        // migration use.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Budget", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] **Budget**"))));

        Assert.Single(AgendaOf(p, noteId));
    }

    [Fact]
    public void A_legacy_item_matches_a_body_line_that_gained_a_newline_when_flattened()
    {
        // AddAgendaItem only trimmed, so a legacy topic can hold a newline; the migration flattens
        // it onto one task line. If the comparison did not collapse whitespace too, every re-run
        // would list the topic again.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Budget\nand headcount", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] Budget and headcount"))));

        Assert.Single(AgendaOf(p, noteId));
    }

    [Theory]
    // Paired delimiters go, and what they wrapped stays.
    [InlineData("**Budget**", "Budget")]
    [InlineData("*Budget*", "Budget")]
    [InlineData("***Budget***", "Budget")]
    [InlineData("~~Budget~~", "Budget")]
    [InlineData("`Budget`", "Budget")]
    [InlineData("_Budget_", "Budget")]
    [InlineData("a**b**c", "abc")]
    [InlineData("**bold _and_ italic**", "bold and italic")]
    // ...and these are NOT emphasis, so they must survive whole. A rule loose enough to strip them
    // would silently merge two topics that differ — which 43-H2 then deletes for good.
    [InlineData("snake_case_name", "snake_case_name")]
    [InlineData("2 * 3", "2 * 3")]
    [InlineData("a _ b", "a _ b")]
    [InlineData("50% * 2 things", "50% * 2 things")]
    [InlineData("`a * b`", "a * b")]
    public void Strips_only_paired_inline_markers(string input, string expected)
    {
        Assert.Equal(expected, AgendaFromContent.StripInlineMarks(input));
    }

    [Fact]
    public void Two_legacy_items_sharing_a_key_are_not_both_absorbed_by_one_body_line()
    {
        // The union matches body lines to legacy items ONE FOR ONE. With a set, both legacy items
        // vanished behind a single body line — and a legacy topic that silently disappears from the
        // view is never migrated, so 43-H2 deletes it for good with nothing to show it was lost.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Budget", 0))));
        p.Handle(Envelope(stream, 3, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "Budget", 1))));
        p.Handle(Envelope(stream, 4, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] Budget"))));

        // One body line absorbs one legacy item; the second survives and stays migratable.
        Assert.Equal(2, AgendaOf(p, noteId).Count);
    }

    [Fact]
    public void A_topic_inside_a_code_span_keeps_its_markers()
    {
        // Code span contents skip the emphasis passes entirely: `**x**` in backticks is the literal
        // text `**x**`, not bold. Stripping backticks first and then running emphasis over the whole
        // string would collapse it to `x` and match a different topic.
        Assert.Equal("**x**", AgendaFromContent.StripInlineMarks("`**x**`"));
    }

    [Theory]
    // CHANGE-38: the header, the peek and the note card show the text the user SEES. Before this,
    // a topic typed with emphasis read as its raw markdown source.
    [InlineData("- [ ] **Budget**", "Budget")]
    [InlineData("- [ ] *Budget*", "Budget")]
    [InlineData("- [ ] ~~Budget~~", "Budget")]
    [InlineData("- [ ] Review `deploy.yml`", "Review deploy.yml")]
    [InlineData("- [ ] **Budget** and _headcount_", "Budget and headcount")]
    // ...and text that only LOOKS like markup is left exactly as typed.
    [InlineData("- [ ] Rename snake_case_name", "Rename snake_case_name")]
    [InlineData("- [ ] Budget is 2 * 3 headcount", "Budget is 2 * 3 headcount")]
    public void A_topic_reads_as_the_user_sees_it_not_as_markdown_source(string body, string expected)
    {
        var (p, noteId) = NoteWith(body);
        Assert.Equal(expected, Assert.Single(AgendaOf(p, noteId)).Text);
    }

    [Fact]
    public void Two_topics_that_read_alike_stay_distinct_even_when_only_one_is_emphasised()
    {
        // Stripping happens BEFORE the ordinal is taken, so `**Budget**` and `Budget` now read the
        // same — and the ordinal is what keeps them two topics with two ids rather than one topic
        // the UI reconciles into itself, swapping their ticked state (the trap Hawk caught in #428).
        var (p, noteId) = NoteWith("- [ ] **Budget**\n- [x] Budget");
        var agenda = AgendaOf(p, noteId);

        Assert.Equal(2, agenda.Count);
        Assert.All(agenda, a => Assert.Equal("Budget", a.Text));
        Assert.NotEqual(agenda[0].ItemId, agenda[1].ItemId);
        Assert.False(agenda[0].Discussed);
        Assert.True(agenda[1].Discussed);
    }

    [Theory]
    // Emphasis WRAPPING a code span is still emphasis — CommonMark renders ``**`x`**`` as bold code,
    // so the topic reads as the code, not as half its markers.
    [InlineData("**`deploy.yml`**", "deploy.yml")]
    // ...but a code span's CONTENTS are code, never emphasis.
    [InlineData("`**x**`", "**x**")]
    // A backslash-escaped run is a LITERAL delimiter the note displays. prosemirror-markdown writes
    // `\*Budget\*` for asterisks the user typed as plain text.
    [InlineData("\\*Budget\\* and 2 \\* 3", "*Budget* and 2 * 3")]
    public void Keeps_markers_that_are_not_emphasis(string input, string expected)
    {
        Assert.Equal(expected, Unescape38(AgendaFromContent.StripInlineMarks(input)));
    }

    // Mirrors Parse's strip-then-unescape order.
    private static string Unescape38(string t) =>
        System.Text.RegularExpressions.Regex.Replace(t, @"\\([\p{P}\p{S}])", "$1");

    [Fact]
    public void A_body_line_still_matches_its_legacy_twin_when_emphasis_wraps_a_code_span()
    {
        // The double-strip regression: Parse returns stripped text and MatchKey stripped it AGAIN,
        // so the body key drifted off its legacy twin. It double-listed, and 43-H1's migration
        // treated the legacy item as still-to-migrate and re-prepended it on EVERY run — the note
        // body growing each time.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "**`deploy.yml`**", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] **`deploy.yml`**"))));

        Assert.Single(AgendaOf(p, noteId));
    }

    [Fact]
    public void A_code_span_body_line_does_not_absorb_a_genuinely_different_legacy_topic()
    {
        // The other half of the double-strip regression, and the worse one: `` `**x**` `` read as
        // `x` on the second strip and swallowed the unrelated legacy topic `x`, which was then never
        // migrated and would be deleted for good by 43-H2, with nothing left to show it was lost.
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, Guid.NewGuid(), "x", 0))));
        p.Handle(Envelope(stream, 3, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "- [ ] `**x**`"))));

        Assert.Equal(2, AgendaOf(p, noteId).Count);
    }

    [Fact]
    public void A_topic_the_user_typed_with_literal_asterisks_keeps_them()
    {
        // Unescaping before stripping deleted exactly the characters the note displays.
        var (p, noteId) = NoteWith(@"- [ ] \*Budget\* and 2 \* 3");
        Assert.Equal("*Budget* and 2 * 3", Assert.Single(AgendaOf(p, noteId)).Text);
    }

    [Fact]
    public void A_pasted_sentinel_character_cannot_throw_out_of_the_fold()
    {
        // The masking placeholder is a private-use character — meaningless in markdown, but NOT
        // impossible in pasted text. Left in place it would be restored as a span index, and on a
        // note with fewer spans that is an IndexOutOfRangeException thrown straight out of the
        // projection fold, DLQ-ing the record and stalling that note.
        var hostile = "\uE00099\uE001 Budget";

        var result = AgendaFromContent.StripInlineMarks(hostile);

        Assert.Equal(" Budget", result);
    }

    [Fact]
    public void A_pathological_line_is_left_alone_rather_than_timing_out_the_fold()
    {
        // A regex timeout would throw out of the projection fold and DLQ the record, stalling that
        // note's projection. Bail on absurd input instead.
        var long_ = new string('`', 3000);
        Assert.Equal(long_, AgendaFromContent.StripInlineMarks(long_));
    }

    [Fact]
    public void A_removed_legacy_item_stays_gone()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var itemId = Guid.NewGuid();
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(Envelope(stream, 2, nameof(AgendaItemAdded),
            JsonSerializer.Serialize(new AgendaItemAdded(noteId, itemId, "Budget (Q3)", 0))));
        p.Handle(Envelope(stream, 3, nameof(AgendaItemRemoved),
            JsonSerializer.Serialize(new AgendaItemRemoved(noteId, itemId))));
        p.Handle(Envelope(stream, 4, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEdited(noteId, "Prose only."))));

        Assert.Empty(AgendaOf(p, noteId));
    }

    [Fact]
    public void ContentEditedV2_derives_topics_the_same_way()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var stream = $"note#{noteId.Value}";
        var p = new NoteDetailProjection();
        p.Handle(Envelope(stream, 1, nameof(NoteCreated), JsonSerializer.Serialize(new NoteCreated(noteId))));
        p.Handle(new EventEnvelope(stream, 2, nameof(ContentEdited), 2, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ContentEditedV2(noteId, "- [ ] Budget (Q3)", 17)),
            new EventMetadata(Guid.NewGuid(), null, null, null)));

        Assert.Equal("Budget (Q3)", Assert.Single(AgendaOf(p, noteId)).Text);
    }
}
