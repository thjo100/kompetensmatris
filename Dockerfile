# Kompetensmatris – bygg med:  docker build -t kompetensmatris .
#
# Bygget hämtar bara två basimager från Microsofts register (mcr.microsoft.com).
# Inga NuGet-paket behövs. Har ni en intern spegel av MCR, t.ex. i Artifactory eller Nexus:
#   docker build --build-arg DOTNET_REGISTRY=<er-spegel> -t kompetensmatris .
# (bygget hämtar då <er-spegel>/dotnet/sdk:10.0 och <er-spegel>/dotnet/aspnet:10.0)
ARG DOTNET_REGISTRY=mcr.microsoft.com

# ---------- Bygg ----------
FROM ${DOTNET_REGISTRY}/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Kompetensmatris/Kompetensmatris.csproj src/Kompetensmatris/
RUN dotnet restore src/Kompetensmatris/Kompetensmatris.csproj
COPY src/ src/
RUN dotnet publish src/Kompetensmatris/Kompetensmatris.csproj -c Release -o /app --no-restore

# ---------- Kör ----------
FROM ${DOTNET_REGISTRY}/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# Datan sparas i en JSON-fil i /data. Montera en volym där så att den finns kvar mellan omstarter.
# Containern kör som användaren "app" (uid 1654), som äger /data.
RUN mkdir -p /data && chown $APP_UID /data
VOLUME /data

ENV ASPNETCORE_HTTP_PORTS=8080 \
    DATA_PATH=/data/kompetensmatris.json \
    TZ=Europe/Stockholm
EXPOSE 8080

USER $APP_UID
ENTRYPOINT ["dotnet", "Kompetensmatris.dll"]
