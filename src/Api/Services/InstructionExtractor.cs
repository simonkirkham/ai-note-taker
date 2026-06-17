namespace Api.Services;

// Splits a note's content into the prose the model should summarise and the inline `/ai`
// instructions it should execute. A line is an instruction when its trimmed text — after an
// optional markdown list marker (`- `, `* `, `+ `) — begins with `/ai ` (case-insensitive).
// The marker must lead the line; a mid-line `path/ai/x` never matches. Empty instructions
// (just `/ai` with no text) are dropped. All other lines pass through verbatim so the grounded
// summary never sees the instruction text.
public static class InstructionExtractor
{
    private const string Marker = "/ai";
    private static readonly string[] ListMarkers = ["- ", "* ", "+ "];

    public static (string CleanedContent, IReadOnlyList<string> Instructions) Extract(string? content)
    {
        if (string.IsNullOrEmpty(content))
            return (content ?? "", []);

        var keptLines = new List<string>();
        var instructions = new List<string>();

        foreach (var line in content.Split('\n'))
        {
            if (TryReadInstruction(line, out var instruction))
            {
                if (instruction.Length > 0)
                    instructions.Add(instruction);
            }
            else
            {
                keptLines.Add(line);
            }
        }

        return (string.Join('\n', keptLines), instructions);
    }

    private static bool TryReadInstruction(string line, out string instruction)
    {
        instruction = "";
        var text = line.TrimStart();

        foreach (var marker in ListMarkers)
        {
            if (text.StartsWith(marker, StringComparison.Ordinal))
            {
                text = text[marker.Length..].TrimStart();
                break;
            }
        }

        if (!text.StartsWith(Marker, StringComparison.OrdinalIgnoreCase))
            return false;

        var rest = text[Marker.Length..];
        // Require whitespace (or end of line) after the marker so `/airplane` is not an instruction.
        if (rest.Length > 0 && !char.IsWhiteSpace(rest[0]))
            return false;

        instruction = rest.Trim();
        return true;
    }
}
