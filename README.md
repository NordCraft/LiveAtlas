# LiveAtlas [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Discord](https://img.shields.io/discord/390942438061113344?color=8C9CFE&label=discord&logo=discord&logoColor=white)](https://discord.gg/DBduB9qyv3) [![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/JLyne/LiveAtlas/main.yml?branch=master)](https://github.com/JLyne/LiveAtlas/actions)

🇷🇺 Для документации на русском языке смотрите [README_ru.md](file:///home/bve/LiveAtlas/README_ru.md).

A map frontend built with [Vue.js](https://github.com/vuejs/vue) and Typescript. Supports [Dynmap](https://github.com/webbukkit/dynmap), [Squaremap](https://github.com/jpenilla/squaremap), [Pl3xmap](https://github.com/NeumimTo/Pl3xMap) and [Overviewer](https://github.com/overviewer/Minecraft-Overviewer).

![A LiveAtlas screenshot](https://minecraft.rtgame.co.uk/liveatlas/liveatlas8.png)

LiveAtlas is an alternative frontend which aims to provide a more modern interface and improved performance for busy maps. LiveAtlas is a drop-in replacement for Dynmap; Squaremap, Pl3xmap and Overviewer maps are supported with some additional configuration.

---

## Standalone Node.js/TypeScript Backend
This version of LiveAtlas features a complete replacement of the legacy PHP standalone webserver scripts (`update.php`, `MySQL_tiles.php`, etc.) with a single, high-performance Node.js/TypeScript backend server.

### Features
1. **Zero PHP Dependency:** Run your standalone LiveAtlas map using only Node.js.
2. **S3-Compatible Storage Support:** Pull and serve map tiles directly from AWS S3, Cloudflare R2, MinIO, Yandex Object Storage, or any other S3-compatible service.
3. **Database Compatibility:** Fetch tiles, configurations, and user authentication details from **MySQL**, **MariaDB**, or **PostgreSQL**.
4. **Built-in i18n (RU/EN):** A built-in language toggle button is added to the sidebar allowing users to dynamically switch the entire interface between Russian and English.

---

## Backend Configuration
Create a `.env` file in the root directory to configure the backend:

```ini
# Port for the LiveAtlas Express server
PORT=8082

# Storage Type: filetree, db, or s3
STORAGE_TYPE=filetree

# Absolute path to your Dynmap plugin data folder (required for local configuration/update files)
DYNMAP_DIR=/path/to/plugins/dynmap

# Database Settings (Required if STORAGE_TYPE=db or using login database)
DB_TYPE=mysql # mysql, mariadb, or postgres
DB_HOST=localhost
DB_PORT=3306
DB_USER=dynmap
DB_PASSWORD=secret_password
DB_NAME=dynmap
DB_PREFIX=dynmap_

# S3 Settings (Required if STORAGE_TYPE=s3)
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=my-dynmap-tiles-bucket
S3_ACCESS_KEY_ID=my_access_key
S3_SECRET_ACCESS_KEY=my_secret_key
S3_PATH_PREFIX=tiles/
```

---

## Building and Running

### 1. Install Dependencies
```bash
yarn install
```

### 2. Build Frontend and Backend
```bash
yarn run build
```
This builds the SPA files to `dist/`, packages the Spigot plugin, and compiles the TypeScript backend to `backend/dist/`.

### 3. Run Dev Server
```bash
yarn run backend:dev
```

### 4. Run Production Server
```bash
yarn run backend:start
```
The server will start listening on the configured `PORT` (default `8082`).

---

## Footnote on AI Development

> [!NOTE]
> Parts of this codebase (specifically the TypeScript Express server, PostgreSQL/MariaDB/MySQL integration, S3 client adapter, and the language switching frontend utility) were developed in collaboration with an AI pair programmer (Google DeepMind's Advanced Agentic Coding assistant).
