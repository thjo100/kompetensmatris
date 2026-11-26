using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Kompetensmatris.Tests;

/// <summary>Startar applikationen i minnet med en egen, tillfällig datafil.</summary>
public sealed class TestApp : WebApplicationFactory<Program>
{
    public const string Password = "testlösen";
    public string DataPath { get; } = Path.Combine(Path.GetTempPath(), "kompetensmatris-test-" + Guid.NewGuid().ToString("N"), "data.json");

    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.UseSetting("DATA_PATH", DataPath);
        builder.UseSetting("ADMIN_PASSWORD", Password);
    }

    public HttpClient Admin()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Admin-Password", Password);
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(Path.GetDirectoryName(DataPath)!, recursive: true); } catch (IOException) { }
    }
}

public class ApiTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = DataStore.JsonOptions;
    private readonly TestApp _app = new();

    public void Dispose() => _app.Dispose();

    private async Task<AppData> GetData() =>
        (await _app.CreateClient().GetFromJsonAsync<AppData>("/api/data", Json))!;

    private async Task<Node> Create(HttpClient client, string? parentId, string title)
    {
        var res = await client.PostAsJsonAsync("/api/nodes", new NodeInput(parentId, title, null, null, null));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<Node>(Json))!;
    }

    [Fact]
    public async Task Exempeldata_skapas_vid_forsta_start()
    {
        var data = await GetData();

        var root = Assert.Single(data.Nodes, n => n.ParentId == null);
        Assert.Equal("LST Systemutvecklare", root.Title);
        Assert.Equal(7, data.Nodes.Count(n => n.ParentId == root.Id));
        Assert.Equal(1, data.Nodes.Single(n => n.Title == "Async/await").Priority);
        Assert.Single(data.Courses);
        Assert.True(File.Exists(_app.DataPath));
    }

    [Fact]
    public async Task Startsidan_serveras()
    {
        var html = await _app.CreateClient().GetStringAsync("/");
        Assert.Contains("Kompetensmatris", html);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("fel")]
    public async Task Andringar_kraver_ratt_losenord(string? password)
    {
        var client = _app.CreateClient();
        if (password != null) client.DefaultRequestHeaders.Add("X-Admin-Password", password);

        var res = await client.PostAsJsonAsync("/api/nodes", new NodeInput(null, "Nytt träd", null, null, null));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.DoesNotContain((await GetData()).Nodes, n => n.Title == "Nytt träd");
    }

    [Fact]
    public async Task Login_svarar_om_losenordet_stammer()
    {
        var client = _app.CreateClient();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/login", new LoginInput(TestApp.Password))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/login", new LoginInput("fel"))).StatusCode);
    }

    [Fact]
    public async Task Skapa_uppdatera_och_ta_bort_nod()
    {
        var admin = _app.Admin();
        var tree = await Create(admin, null, "Testare");
        var child = await Create(admin, tree.Id, "Testdesign");

        var update = new NodeInput(null, "Testdesign & testteknik", 2, "Ekvivalensklasser m.m.", [new Link("ISTQB", "https://www.istqb.org/")]);
        var res = await admin.PutAsJsonAsync($"/api/nodes/{child.Id}", update);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var saved = (await GetData()).Nodes.Single(n => n.Id == child.Id);
        Assert.Equal("Testdesign & testteknik", saved.Title);
        Assert.Equal(2, saved.Priority);
        Assert.Equal("ISTQB", Assert.Single(saved.Links).Title);
        Assert.Equal(tree.Id, saved.ParentId);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/nodes/{tree.Id}")).StatusCode);
        var data = await GetData();
        Assert.DoesNotContain(data.Nodes, n => n.Id == tree.Id || n.Id == child.Id);
    }

    [Fact]
    public async Task Felaktig_indata_ger_400_med_felmeddelande()
    {
        var admin = _app.Admin();

        var noTitle = await admin.PostAsJsonAsync("/api/nodes", new NodeInput(null, "  ", null, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, noTitle.StatusCode);
        Assert.Contains("Titel", await noTitle.Content.ReadAsStringAsync());

        var badPriority = await admin.PostAsJsonAsync("/api/nodes", new NodeInput(null, "X", 7, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, badPriority.StatusCode);

        var badLink = await admin.PostAsJsonAsync("/api/nodes", new NodeInput(null, "X", null, null, [new Link("", "javascript:alert(1)")]));
        Assert.Equal(HttpStatusCode.BadRequest, badLink.StatusCode);

        var missingParent = await admin.PostAsJsonAsync("/api/nodes", new NodeInput("finns-inte", "X", null, null, null));
        Assert.Equal(HttpStatusCode.NotFound, missingParent.StatusCode);
    }

    [Fact]
    public async Task Flytta_nod_andrar_ordning_och_forälder()
    {
        var admin = _app.Admin();
        var tree = await Create(admin, null, "Träd");
        var a = await Create(admin, tree.Id, "A");
        var b = await Create(admin, tree.Id, "B");
        var c = await Create(admin, tree.Id, "C");

        // C först
        await admin.PostAsJsonAsync($"/api/nodes/{c.Id}/move", new MoveInput(tree.Id, 0));
        var order = (await GetData()).Nodes.Where(n => n.ParentId == tree.Id).Select(n => n.Title);
        Assert.Equal(["C", "A", "B"], order);

        // A ned ett steg
        await admin.PostAsJsonAsync($"/api/nodes/{a.Id}/move", new MoveInput(tree.Id, 2));
        order = (await GetData()).Nodes.Where(n => n.ParentId == tree.Id).Select(n => n.Title);
        Assert.Equal(["C", "B", "A"], order);

        // B in under C
        await admin.PostAsJsonAsync($"/api/nodes/{b.Id}/move", new MoveInput(c.Id, 0));
        Assert.Equal(c.Id, (await GetData()).Nodes.Single(n => n.Id == b.Id).ParentId);
    }

    [Fact]
    public async Task Nod_kan_inte_flyttas_in_under_sig_sjalv()
    {
        var admin = _app.Admin();
        var tree = await Create(admin, null, "Träd");
        var parent = await Create(admin, tree.Id, "Förälder");
        var child = await Create(admin, parent.Id, "Barn");

        var res = await admin.PostAsJsonAsync($"/api/nodes/{parent.Id}/move", new MoveInput(child.Id, 0));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(tree.Id, (await GetData()).Nodes.Single(n => n.Id == parent.Id).ParentId);
    }

    [Fact]
    public async Task Indenterad_lista_blir_ett_trad()
    {
        var admin = _app.Admin();
        var tree = await Create(admin, null, "Träd");
        const string text = """
            Frontend
              [1] HTML
              - CSS
                Flexbox
            	Grid
            (2) Backend
            """;

        var res = await admin.PostAsJsonAsync("/api/nodes/outline", new OutlineInput(tree.Id, text));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var nodes = (await res.Content.ReadFromJsonAsync<List<Node>>(Json))!;
        Assert.Equal(6, nodes.Count);
        Node Get(string title) => nodes.Single(n => n.Title == title);
        Assert.Equal(tree.Id, Get("Frontend").ParentId);
        Assert.Equal(Get("Frontend").Id, Get("HTML").ParentId);
        Assert.Equal(1, Get("HTML").Priority);
        Assert.Equal(Get("Frontend").Id, Get("CSS").ParentId);
        Assert.Equal(Get("CSS").Id, Get("Flexbox").ParentId);
        Assert.Equal(Get("CSS").Id, Get("Grid").ParentId); // tab = 4 mellanslag
        Assert.Equal(tree.Id, Get("Backend").ParentId);
        Assert.Equal(2, Get("Backend").Priority);
    }

    [Fact]
    public async Task Kurser_kan_skapas_andras_och_tas_bort_med_sin_nod()
    {
        var admin = _app.Admin();
        var tree = await Create(admin, null, "Träd");
        var area = await Create(admin, tree.Id, "GIS");
        var start = new DateTimeOffset(2030, 3, 14, 13, 0, 0, TimeSpan.FromHours(1));

        var res = await admin.PostAsJsonAsync("/api/courses", new CourseInput(area.Id, "GeoJSON grund", start, start.AddHours(2), "https://teams.microsoft.com/l/meetup-join/abc", "Lisa", null));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var course = (await res.Content.ReadFromJsonAsync<Course>(Json))!;

        res = await admin.PutAsJsonAsync($"/api/courses/{course.Id}", new CourseInput(area.Id, "GeoJSON fördjupning", start, null, null, null, null));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var saved = (await GetData()).Courses.Single(c => c.Id == course.Id);
        Assert.Equal("GeoJSON fördjupning", saved.Title);
        Assert.Null(saved.Url);
        Assert.Equal(start, saved.Start);

        // Slut före start är inte tillåtet.
        res = await admin.PutAsJsonAsync($"/api/courses/{course.Id}", new CourseInput(area.Id, "X", start, start.AddHours(-1), null, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // Kursen försvinner när området tas bort.
        await admin.DeleteAsync($"/api/nodes/{area.Id}");
        Assert.DoesNotContain((await GetData()).Courses, c => c.Id == course.Id);
    }

    [Fact]
    public async Task Export_och_import_ger_samma_data()
    {
        var admin = _app.Admin();
        var exported = await admin.GetStringAsync("/api/data");
        await Create(admin, null, "Tillfälligt träd");

        var res = await admin.PutAsync("/api/data", new StringContent(exported, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.DoesNotContain((await GetData()).Nodes, n => n.Title == "Tillfälligt träd");
    }

    [Fact]
    public async Task Import_med_trasig_data_avvisas()
    {
        var admin = _app.Admin();
        var broken = new AppData { Nodes = [new Node { Id = "a", ParentId = "saknas", Title = "A" }] };

        var res = await admin.PutAsJsonAsync("/api/data", broken, Json);

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains((await GetData()).Nodes, n => n.Title == "LST Systemutvecklare");
    }

    [Fact]
    public async Task Data_finns_kvar_efter_omstart()
    {
        var admin = _app.Admin();
        await Create(admin, null, "Sparat träd");

        // En ny DataStore läser samma fil, precis som när containern startas om.
        var reloaded = new DataStore(_app.DataPath);
        Assert.Contains("Sparat träd", reloaded.Json);
    }
}

public class KodvyTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = DataStore.JsonOptions;
    private readonly TestApp _app = new();

    public void Dispose() => _app.Dispose();

    private async Task<AppData> GetData() =>
        (await _app.CreateClient().GetFromJsonAsync<AppData>("/api/data", Json))!;

    private async Task<(Node Root, Node A, Node B, Course Course)> CreateTree(HttpClient admin)
    {
        var res = await admin.PostAsJsonAsync("/api/nodes/outline", new OutlineInput(null, "Träd\n  A\n  B"));
        var nodes = (await res.Content.ReadFromJsonAsync<List<Node>>(Json))!;
        var b = nodes.Single(n => n.Title == "B");
        await admin.PutAsJsonAsync($"/api/nodes/{b.Id}", new NodeInput(null, "B", null, "Beskrivning av B", null));
        var course = (await (await admin.PostAsJsonAsync("/api/courses",
            new CourseInput(b.Id, "Kurs i B", DateTimeOffset.UtcNow.AddDays(3), null, null, null, null)))
            .Content.ReadFromJsonAsync<Course>(Json))!;
        return (nodes[0], nodes[1], b, course);
    }

    [Fact]
    public async Task Namnbyte_flytt_och_nya_rader_behaller_kurser_och_beskrivning()
    {
        var admin = _app.Admin();
        var (root, a, b, course) = await CreateTree(admin);

        // B byter namn och flyttas in under A, en ny rad C läggs till sist.
        var res = await admin.PutAsJsonAsync($"/api/trees/{root.Id}", new TreeInput([
            new(root.Id, null, "Träd", null),
            new(a.Id, root.Id, "A", 1),
            new(b.Id, a.Id, "B (nytt namn)", null),
            new("nyttid123", root.Id, "C", null),
        ]));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var data = await GetData();
        var savedB = data.Nodes.Single(n => n.Id == b.Id);
        Assert.Equal("B (nytt namn)", savedB.Title);
        Assert.Equal(a.Id, savedB.ParentId);
        Assert.Equal("Beskrivning av B", savedB.Description);
        Assert.Contains(data.Courses, c => c.Id == course.Id);
        Assert.Equal(1, data.Nodes.Single(n => n.Id == a.Id).Priority);
        Assert.Equal(["A", "C"], data.Nodes.Where(n => n.ParentId == root.Id).Select(n => n.Title));
    }

    [Fact]
    public async Task Rader_som_tas_bort_forsvinner_med_sina_kurser()
    {
        var admin = _app.Admin();
        var (root, a, b, course) = await CreateTree(admin);

        var res = await admin.PutAsJsonAsync($"/api/trees/{root.Id}", new TreeInput([
            new(root.Id, null, "Träd", null),
            new(a.Id, root.Id, "A", null),
        ]));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var data = await GetData();
        Assert.DoesNotContain(data.Nodes, n => n.Id == b.Id);
        Assert.DoesNotContain(data.Courses, c => c.Id == course.Id);
        Assert.Contains(data.Nodes, n => n.Title == "LST Systemutvecklare"); // andra träd orörda
    }

    [Fact]
    public async Task Ogiltig_struktur_avvisas_och_lamnar_datan_orord()
    {
        var admin = _app.Admin();
        var (root, a, b, _) = await CreateTree(admin);
        var otherTree = (await GetData()).Nodes.First(n => n.Title == "Async/await");

        // Barn före sin förälder.
        var res = await admin.PutAsJsonAsync($"/api/trees/{root.Id}", new TreeInput([
            new(root.Id, null, "Träd", null),
            new(b.Id, a.Id, "B", null),
            new(a.Id, root.Id, "A", null),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // Id från ett annat träd.
        res = await admin.PutAsJsonAsync($"/api/trees/{root.Id}", new TreeInput([
            new(root.Id, null, "Träd", null),
            new(otherTree.Id, root.Id, "Stulen", null),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // Tom titel längre ned: inget av det som kom före får sparas.
        res = await admin.PutAsJsonAsync($"/api/trees/{root.Id}", new TreeInput([
            new(root.Id, null, "Nytt namn", null),
            new(a.Id, root.Id, " ", null),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        var data = await GetData();
        Assert.Equal("Träd", data.Nodes.Single(n => n.Id == root.Id).Title);
        Assert.Equal(root.Id, data.Nodes.Single(n => n.Id == b.Id).ParentId);
        Assert.Equal("Async/await", data.Nodes.Single(n => n.Id == otherTree.Id).Title);
    }
}
