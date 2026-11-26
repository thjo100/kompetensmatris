using System.Text.RegularExpressions;

namespace Kompetensmatris;

public record OutlineItem(string Title, int? Priority, List<OutlineItem> Children);

/// <summary>
/// Tolkar en indenterad textlista till ett träd, t.ex. inklistrad från MindManager, Word eller Markdown:
/// <code>
/// Frontend/klient
///   [1] HTML
///   [1] CSS
///   JavaScript
///     TypeScript
/// </code>
/// Indrag (mellanslag eller tab) anger nivå. "[1]", "[2]" eller "[3]" först på raden blir prioritet.
/// Punktlistetecken (-, *, •) i början av raden tas bort.
/// </summary>
public static partial class Outline
{
    public static List<OutlineItem> Parse(string text)
    {
        var roots = new List<OutlineItem>();
        var stack = new Stack<(int Indent, OutlineItem Item)>();

        foreach (var rawLine in text.Replace("\r", "").Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(rawLine)) continue;

            var indent = 0;
            foreach (var ch in rawLine)
            {
                if (ch == ' ') indent += 1;
                else if (ch == '\t') indent += 4;
                else break;
            }

            var line = Bullet().Replace(rawLine.Trim(), "");
            int? priority = null;
            var match = PriorityPrefix().Match(line);
            if (match.Success)
            {
                priority = int.Parse(match.Groups[1].Value);
                line = line[match.Length..];
            }
            line = line.Trim();
            if (line.Length == 0) continue;
            if (line.Length > 200) throw ApiException.BadRequest($"Raden \"{line[..40]}…\" är längre än 200 tecken.");

            var item = new OutlineItem(line, priority, []);
            while (stack.Count > 0 && stack.Peek().Indent >= indent) stack.Pop();
            (stack.Count > 0 ? stack.Peek().Item.Children : roots).Add(item);
            stack.Push((indent, item));
        }
        return roots;
    }

    [GeneratedRegex(@"^([-*•+]|\d+\.)\s+")]
    private static partial Regex Bullet();

    [GeneratedRegex(@"^[\[(]([123])[\])]\s*")]
    private static partial Regex PriorityPrefix();
}
