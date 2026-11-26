using System.Text.Json.Serialization;
using Kompetensmatris;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var env = sp.GetRequiredService<IWebHostEnvironment>();
    var path = config["DATA_PATH"] ?? Path.Combine(env.ContentRootPath, "data", "kompetensmatris.json");
    return new DataStore(path, sp.GetRequiredService<ILogger<DataStore>>());
});
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);

var app = builder.Build();

if (string.IsNullOrEmpty(app.Configuration["ADMIN_PASSWORD"]))
    app.Logger.LogWarning("ADMIN_PASSWORD är inte satt. Standardlösenordet \"admin\" används.");

// Läs in (eller skapa) datafilen direkt vid start så att fel syns i loggen med en gång.
app.Services.GetRequiredService<DataStore>();

// Fel från valideringen skickas till webbläsaren som { "error": "..." }.
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (ApiException e)
    {
        context.Response.StatusCode = e.StatusCode;
        await context.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

app.UseDefaultFiles();
app.UseStaticFiles();

// ---------- Öppet för alla ----------

app.MapGet("/health", () => "ok");

app.MapGet("/api/data", (DataStore store) => Results.Text(store.Json, "application/json; charset=utf-8"));

app.MapPost("/api/login", (LoginInput input, IConfiguration config) =>
    IsAdmin(input.Password, config) ? Results.NoContent() : Results.Unauthorized());

// ---------- Kräver adminlösenordet i headern X-Admin-Password ----------

var admin = app.MapGroup("/api").AddEndpointFilter(async (context, next) =>
{
    var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
    var password = context.HttpContext.Request.Headers["X-Admin-Password"].ToString();
    return IsAdmin(password, config) ? await next(context) : Results.Unauthorized();
});

admin.MapPost("/nodes", (NodeInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.AddNode(input))));

admin.MapPost("/nodes/outline", (OutlineInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.AddOutline(input))));

admin.MapPut("/nodes/{id}", (string id, NodeInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.UpdateNode(id, input))));

admin.MapPost("/nodes/{id}/move", (string id, MoveInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.MoveNode(id, input))));

admin.MapDelete("/nodes/{id}", (string id, DataStore store) =>
{
    store.Update(d => { d.DeleteNode(id); return true; });
    return Results.NoContent();
});

// Kod-vyn: ersätter ett helt träds struktur (namn, prioritet, ordning och nivåer).
admin.MapPut("/trees/{id}", (string id, TreeInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.ReplaceTree(id, input))));

admin.MapPost("/courses", (CourseInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.AddCourse(input))));

admin.MapPut("/courses/{id}", (string id, CourseInput input, DataStore store) =>
    Results.Ok(store.Update(d => d.UpdateCourse(id, input))));

admin.MapDelete("/courses/{id}", (string id, DataStore store) =>
{
    store.Update(d => { d.DeleteCourse(id); return true; });
    return Results.NoContent();
});

// Import: ersätter all data med innehållet i en tidigare exporterad JSON-fil.
admin.MapPut("/data", (AppData data, DataStore store) =>
{
    store.Replace(data);
    return Results.NoContent();
});

app.Run();

static bool IsAdmin(string? password, IConfiguration config) =>
    !string.IsNullOrEmpty(password) && password == (config["ADMIN_PASSWORD"] is { Length: > 0 } p ? p : "admin");

// Gör Program synlig för integrationstesterna.
public partial class Program;
