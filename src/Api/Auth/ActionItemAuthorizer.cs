using Domain.ActionItems;
using EventStore;
using Microsoft.Extensions.Logging;

namespace Api.Auth;

// 41-B: strongly-consistent action-item ownership, read from the action's EVENT STREAM — the
// object-level auth a note-scoped action write needs. The note-ownership check (INoteAuthorizer)
// proves you own a note, but completing/reopening an action must prove you own *that action*:
// authorizing a caller-supplied noteId leaves the action↔note binding unchecked (an IDOR — own any
// note, know any actionId, mutate it). The action's owner is the UserId stamped on its first event
// (ActionItemAdded), the same rule NoteAuthorizer uses for notes. Strongly consistent (event stream,
// not the async projection — BUG-30).
public interface IActionItemAuthorizer
{
    Task<bool> OwnsActionAsync(ActionId actionId, string userId, CancellationToken ct = default);
}

public sealed class ActionItemAuthorizer(IEventStore store, ILogger<ActionItemAuthorizer>? logger = null) : IActionItemAuthorizer
{
    public async Task<bool> OwnsActionAsync(ActionId actionId, string userId, CancellationToken ct = default)
    {
        var history = await store.ReadAsync(actionId.ToStreamId(), ct).ConfigureAwait(false);
        if (history.Count == 0)                                                  // never created
            return false;
        if (history.Any(e => e.EventType == nameof(ActionItemDeleted)))          // deleted (no un-delete)
            return false;
        // Owner = the UserId on the first event. A null owner is a legacy pre-Phase-8 single-user item
        // → not enforced (matches NoteAuthorizer). An owner mismatch is a cross-user attempt.
        var owner = history[0].Metadata.UserId;
        var owns = owner is null || owner == userId;
        if (!owns)
            logger?.LogWarning("action-auth denied: owner {Owner} != {User} for {Stream}", owner, userId, actionId.ToStreamId());
        return owns;
    }
}
