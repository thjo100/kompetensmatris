# Bygg
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Kompetensmatris/Kompetensmatris.csproj src/Kompetensmatris/
RUN dotnet restore src/Kompetensmatris/Kompetensmatris.csproj
COPY src/ src/
RUN dotnet publish src/Kompetensmatris/Kompetensmatris.csproj -c Release -o /app --no-restore

# Kör
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# Datan sparas i en JSON-fil i /data. Montera en volym där så att den finns kvar mellan omstarter.
RUN mkdir -p /data && chown $APP_UID /data
VOLUME /data

ENV ASPNETCORE_HTTP_PORTS=8080 \
    DATA_PATH=/data/kompetensmatris.json \
    TZ=Europe/Stockholm
EXPOSE 8080

USER $APP_UID
ENTRYPOINT ["dotnet", "Kompetensmatris.dll"]
