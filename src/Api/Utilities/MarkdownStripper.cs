using System.Text.RegularExpressions;

namespace Api.Utilities;

internal static class MarkdownStripper
{
    private static readonly Regex HeadingPattern = new(@"^#{1,6}\s*", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex StrikethroughPattern = new(@"~~(.+?)~~", RegexOptions.Compiled);
    private static readonly Regex BoldPattern = new(@"\*\*(.+?)\*\*", RegexOptions.Compiled);
    private static readonly Regex ItalicPattern = new(@"\*(.+?)\*", RegexOptions.Compiled);
    private static readonly Regex TaskItemPattern = new(@"^\s*-\s+\[[ x]\]\s*", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex BulletPattern = new(@"^\s*[-*]\s+", RegexOptions.Multiline | RegexOptions.Compiled);
    private static readonly Regex OrderedListPattern = new(@"^\s*\d+\.\s+", RegexOptions.Multiline | RegexOptions.Compiled);

    internal static string Strip(string content)
    {
        if (string.IsNullOrEmpty(content)) return content;
        var s = HeadingPattern.Replace(content, "");
        s = StrikethroughPattern.Replace(s, "$1");
        s = BoldPattern.Replace(s, "$1");
        s = ItalicPattern.Replace(s, "$1");
        s = TaskItemPattern.Replace(s, "");
        s = BulletPattern.Replace(s, "");
        s = OrderedListPattern.Replace(s, "");
        return s.Trim();
    }
}
