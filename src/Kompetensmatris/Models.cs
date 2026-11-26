namespace Kompetensmatris;

/// <summary>All data i applikationen. Sparas som en JSON-fil.</summary>
/// <remarks>
/// Noderna ligger i en platt lista där <see cref="Node.ParentId"/> pekar på föräldern.
/// Noder utan förälder är rötter, dvs. varsitt träd. Syskonens ordning är ordningen i listan.
/// </remarks>
public partial class AppData
{
    public List<Node> Nodes { get; set; } = [];
    public List<Course> Courses { get; set; } = [];

    // ---------- Noder ----------

    public Node AddNode(NodeInput input)
    {
        if (input.ParentId != null) GetNode(input.ParentId);
        var node = new Node { Id = NewId(), ParentId = input.ParentId };
        Apply(node, input);
        Nodes.Add(node);
        return node;
    }

    public Node UpdateNode(string id, NodeInput input)
    {
        var node = GetNode(id);
        Apply(node, input);
        return node;
    }

    public void DeleteNode(string id)
    {
        GetNode(id);
        var ids = SubtreeIds(id);
        Nodes.RemoveAll(n => ids.Contains(n.Id));
        Courses.RemoveAll(c => ids.Contains(c.NodeId));
    }

    /// <summary>Flyttar en nod till en (ny) förälder och placerar den på plats <c>Index</c> bland syskonen.</summary>
    public Node MoveNode(string id, MoveInput input)
    {
        var node = GetNode(id);
        if (input.ParentId != null)
        {
            GetNode(input.ParentId);
            if (SubtreeIds(id).Contains(input.ParentId))
                throw ApiException.BadRequest("En nod kan inte flyttas in under sig själv.");
        }

        Nodes.Remove(node);
        node.ParentId = input.ParentId;
        var siblings = Nodes.Where(n => n.ParentId == input.ParentId).ToList();
        var index = Math.Clamp(input.Index, 0, siblings.Count);
        var insertAt = index < siblings.Count ? Nodes.IndexOf(siblings[index])
            : siblings.Count > 0 ? Nodes.IndexOf(siblings[^1]) + 1
            : Nodes.Count;
        Nodes.Insert(insertAt, node);
        return node;
    }

    /// <summary>Skapar många noder på en gång från en indenterad textlista (se <see cref="Outline"/>).</summary>
    public List<Node> AddOutline(OutlineInput input)
    {
        if (input.ParentId != null) GetNode(input.ParentId);
        var items = Outline.Parse(input.Text ?? "");
        if (items.Count == 0) throw ApiException.BadRequest("Texten innehåller inga rader.");

        var created = new List<Node>();
        void Add(string? parentId, IEnumerable<OutlineItem> list)
        {
            foreach (var item in list)
            {
                var node = new Node { Id = NewId(), ParentId = parentId, Title = item.Title, Priority = item.Priority };
                Nodes.Add(node);
                created.Add(node);
                Add(node.Id, item.Children);
            }
        }
        Add(input.ParentId, items);
        return created;
    }

    /// <summary>
    /// Ersätter ett helt träds struktur (används av Kod-vyn). <c>Nodes</c> är trädets noder i dokumentordning,
    /// roten först och varje förälder före sina barn. Befintliga id:n behåller beskrivning, länkar och kurser,
    /// nya id:n skapas och noder i trädet som inte finns med tas bort (tillsammans med sina kurser).
    /// </summary>
    public List<Node> ReplaceTree(string rootId, TreeInput input)
    {
        var root = GetNode(rootId);
        if (root.ParentId != null) throw ApiException.BadRequest("Det är inte roten i ett träd.");
        var items = input.Nodes ?? [];
        if (items.Count == 0 || items[0].Id != rootId || items[0].ParentId != null)
            throw ApiException.BadRequest("Första raden måste vara trädets rot.");

        var treeIds = SubtreeIds(rootId);
        var byId = Nodes.Where(n => treeIds.Contains(n.Id)).ToDictionary(n => n.Id);
        var seen = new HashSet<string>();
        var result = new List<Node>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item.Id is null || !ValidId().IsMatch(item.Id)) throw ApiException.BadRequest("Ogiltigt id.");
            if (!seen.Add(item.Id)) throw ApiException.BadRequest($"Id {item.Id} förekommer flera gånger.");
            if (!treeIds.Contains(item.Id) && Nodes.Any(n => n.Id == item.Id))
                throw ApiException.BadRequest($"Id {item.Id} tillhör ett annat träd.");
            if (i > 0 && (item.ParentId is null || !seen.Contains(item.ParentId) || item.ParentId == item.Id))
                throw ApiException.BadRequest($"\"{item.Title}\" måste ligga under en rad ovanför sig.");
            var title = Required(item.Title, "Titel", 200);
            if (item.Priority is < 1 or > 3) throw ApiException.BadRequest("Prioritet måste vara 1, 2, 3 eller tom.");

            var node = byId.GetValueOrDefault(item.Id) ?? new Node { Id = item.Id };
            node.ParentId = item.ParentId;
            node.Title = title;
            node.Priority = item.Priority;
            result.Add(node);
        }

        var removed = treeIds.Where(id => !seen.Contains(id)).ToHashSet();
        Courses.RemoveAll(c => removed.Contains(c.NodeId));
        var position = Nodes.FindIndex(n => treeIds.Contains(n.Id)); // behåll trädets plats bland rötterna
        Nodes.RemoveAll(n => treeIds.Contains(n.Id));
        Nodes.InsertRange(Math.Clamp(position, 0, Nodes.Count), result);
        return result;
    }

    // ---------- Kurser ----------

    public Course AddCourse(CourseInput input)
    {
        var course = new Course { Id = NewId() };
        Apply(course, input);
        Courses.Add(course);
        return course;
    }

    public Course UpdateCourse(string id, CourseInput input)
    {
        var course = Courses.Find(c => c.Id == id) ?? throw ApiException.NotFound("Kursen finns inte.");
        Apply(course, input);
        return course;
    }

    public void DeleteCourse(string id)
    {
        if (Courses.RemoveAll(c => c.Id == id) == 0) throw ApiException.NotFound("Kursen finns inte.");
    }

    // ---------- Import ----------

    /// <summary>Kontrollerar att importerad data hänger ihop innan den ersätter befintlig data.</summary>
    public void Validate()
    {
        Nodes ??= [];
        Courses ??= [];
        var ids = new HashSet<string>();
        foreach (var n in Nodes)
        {
            if (string.IsNullOrWhiteSpace(n.Id) || !ids.Add(n.Id)) throw ApiException.BadRequest("Alla noder måste ha ett unikt id.");
            if (string.IsNullOrWhiteSpace(n.Title)) throw ApiException.BadRequest($"Noden {n.Id} saknar titel.");
            n.Links ??= [];
        }
        foreach (var n in Nodes)
        {
            if (n.ParentId != null && !ids.Contains(n.ParentId))
                throw ApiException.BadRequest($"Noden \"{n.Title}\" pekar på en förälder som inte finns.");
        }
        foreach (var n in Nodes)
        {
            // Leta efter cykler genom att gå uppåt i trädet.
            var seen = new HashSet<string> { n.Id };
            for (var p = n.ParentId; p != null; p = Nodes.First(x => x.Id == p).ParentId)
                if (!seen.Add(p)) throw ApiException.BadRequest($"Noden \"{n.Title}\" ligger i en cykel.");
        }
        var courseIds = new HashSet<string>();
        foreach (var c in Courses)
        {
            if (string.IsNullOrWhiteSpace(c.Id) || !courseIds.Add(c.Id)) throw ApiException.BadRequest("Alla kurser måste ha ett unikt id.");
            if (!ids.Contains(c.NodeId)) throw ApiException.BadRequest($"Kursen \"{c.Title}\" pekar på en nod som inte finns.");
        }
    }

    // ---------- Hjälpmetoder ----------

    private Node GetNode(string id) =>
        Nodes.Find(n => n.Id == id) ?? throw ApiException.NotFound("Noden finns inte.");

    private HashSet<string> SubtreeIds(string id)
    {
        var result = new HashSet<string> { id };
        var queue = new Queue<string>([id]);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var child in Nodes.Where(n => n.ParentId == current))
                if (result.Add(child.Id)) queue.Enqueue(child.Id);
        }
        return result;
    }

    private static void Apply(Node node, NodeInput input)
    {
        // Validera allt först så att noden inte blir halvt uppdaterad.
        var title = Required(input.Title, "Titel", 200);
        if (input.Priority is < 1 or > 3) throw ApiException.BadRequest("Prioritet måste vara 1, 2, 3 eller tom.");
        var links = (input.Links ?? [])
            .Where(l => !string.IsNullOrWhiteSpace(l.Url))
            .Select(l => new Link(Optional(l.Title, "Länktitel", 200) ?? l.Url.Trim(), Url(l.Url, "Länk")!))
            .ToList();

        node.Title = title;
        node.Priority = input.Priority;
        node.Description = Optional(input.Description, "Beskrivning", 10_000);
        node.Links = links;
    }

    private void Apply(Course course, CourseInput input)
    {
        var nodeId = input.NodeId ?? throw ApiException.BadRequest("Kursen måste höra till ett område.");
        GetNode(nodeId);
        var title = Required(input.Title, "Kursnamn", 200);
        var start = input.Start ?? throw ApiException.BadRequest("Kursen måste ha en starttid.");
        if (input.End != null && input.End < start) throw ApiException.BadRequest("Sluttiden kan inte vara före starttiden.");

        course.NodeId = nodeId;
        course.Title = title;
        course.Start = start;
        course.End = input.End;
        course.Url = Url(input.Url, "Möteslänk");
        course.Teacher = Optional(input.Teacher, "Kursledare", 200);
        course.Description = Optional(input.Description, "Beskrivning", 10_000);
    }

    private static string Required(string? value, string field, int maxLength) =>
        Optional(value, field, maxLength) ?? throw ApiException.BadRequest($"{field} måste fyllas i.");

    private static string? Optional(string? value, string field, int maxLength)
    {
        value = value?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        if (value.Length > maxLength) throw ApiException.BadRequest($"{field} får vara högst {maxLength} tecken.");
        return value;
    }

    private static string? Url(string? value, string field)
    {
        value = Optional(value, field, 2000);
        if (value == null) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto"))
            throw ApiException.BadRequest($"{field} måste börja med http:// eller https://");
        return value;
    }

    private static string NewId() => Guid.NewGuid().ToString("N")[..10];

    [System.Text.RegularExpressions.GeneratedRegex("^[A-Za-z0-9_-]{1,40}$")]
    private static partial System.Text.RegularExpressions.Regex ValidId();
}

public class Node
{
    public string Id { get; set; } = "";
    public string? ParentId { get; set; }
    public string Title { get; set; } = "";
    /// <summary>1, 2 eller 3 (visas som röd, blå respektive grön etikett). Null = ingen prioritet.</summary>
    public int? Priority { get; set; }
    public string? Description { get; set; }
    public List<Link> Links { get; set; } = [];
}

public record Link(string Title, string Url);

public class Course
{
    public string Id { get; set; } = "";
    public string NodeId { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTimeOffset Start { get; set; }
    public DateTimeOffset? End { get; set; }
    /// <summary>Länk till Teams-mötet (eller motsvarande).</summary>
    public string? Url { get; set; }
    public string? Teacher { get; set; }
    public string? Description { get; set; }
}

// ---------- Indata från API:t ----------

public record NodeInput(string? ParentId, string? Title, int? Priority, string? Description, List<Link>? Links);
public record MoveInput(string? ParentId, int Index);
public record OutlineInput(string? ParentId, string? Text);
public record CourseInput(string? NodeId, string? Title, DateTimeOffset? Start, DateTimeOffset? End, string? Url, string? Teacher, string? Description);
public record LoginInput(string? Password);
public record TreeNodeInput(string? Id, string? ParentId, string? Title, int? Priority);
public record TreeInput(List<TreeNodeInput>? Nodes);

/// <summary>Fel som ska visas för användaren, t.ex. "Titel måste fyllas i".</summary>
public class ApiException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public static ApiException BadRequest(string message) => new(StatusCodes.Status400BadRequest, message);
    public static ApiException NotFound(string message) => new(StatusCodes.Status404NotFound, message);
}
