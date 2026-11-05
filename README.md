# Plex album date manipulator

In a large Plex album library, I like to be able to see things in the order that I acquired them. If I purchase a record while traveling, however, it may be a while before I can get home and digitize it; I also might get something on Bandcamp while out and about then forget to add it to the library until a month or so later.

Plex doesn't provide tools for manipulating date added. This project therefore builds a custom interface for browsing Albums in my music library, and lets me easily change the date associated with a record.

## Using the tool

Run `plex-redate` in a directory containing a backup of the Plex database. It will identify and load the DB backup, and show you recent albums

```sh
% plex-redate
Using com.plexapp.plugins.library.db
? Recently added albums
❯◯ 2026-11-05  bee paang — For the Luminous Warmth - 予光之境
 ◯ 2026-11-04  Kyle Sanna — Everything Again Is New
 ◯ 2026-11-04  YOASOBI — THE BOOK 3
```

Use the up and down arrows to choose an album. Press Space to mark an album as selected, and/or press Enter to proceed to date assignment for all selected albums, or the currently-highlighted row if nothing is selected.

You can enter the date using an ISO timestamp or in human language, and time zone overrides are usually understood:

```
space tick · enter select+submit · esc quit
? New added date for 1 album(s): October 28, 2024, 7pm JST
```

The script will then prompt you for confirmation,

```
✔ New added date for 1 album(s): October 28, 2024, 7pm JST
  YOASOBI — THE BOOK 3
? Set these to Monday, October 28, 2024 at 19:00 (Japan Standard Time)? (Y/n)
```

When you select "Y", the script will adjust the metadata rows for that album (each individual track and the album row itself), and optionally backdate the addition of the artist's DB record as well if the new date is earlier than Plex's first encounter with that artist.

Press Escape on the album selection screen to quit.

### Database selection behavior and available flags

The DB is resolved in this order: `--db <path>`, the `PLEX_LIBRARY_DB` environment variable, then any `*.db` in the current directory containing a `metadata_items` table.

| Flag | Default | Purpose |
|---|---|---|
| `--db`, `-d` | auto | Path to the library DB |
| `--limit`, `-n` | 40 | How many recent albums to list |
| `--search`, `-s` | | Filter by album or artist title |

While viewing the album list, `space` selects a row, `Enter` submits all selected rows (or the highlighted row), and `Escape` quits.

## Installation

Requires Node 22.5 or newer (uses the built-in `node:sqlite`).

```sh
git clone <this repo> plex-album-redate
cd plex-album-redate
npm install
npm link
```

`npm link` puts `plex-redate` on your PATH for the active Node version. With nvm or fnm, re-run `npm link` after switching Node versions. To remove it, run `npm unlink -g plex-redate`.

## Backing up and unlocking the Plex database

Editing the Plex DB is a little less straightforward than it used to be because of SQLite triggers.

I use a script like this to back up the Plex DB, and to "unlock" it by removing triggers. Thank you to [this Plex forum post](https://forums.plex.tv/t/can-no-longer-update-library-database-with-sqlite3/701405/49) for the commands.

```sh
#!/usr/bin/env bash

echo "Backing up DB..."
cp ~/Library/Application\ Support/Plex\ Media\ Server/Plug-in\ Support/Databases/com.plexapp.plugins.library.db ./com.plexapp.plugins.library.db
echo "Copied DB from Plex directory"

# Get the triggers list.
sqlite3 com.plexapp.plugins.library.db "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='metadata_items' AND name LIKE '%update%';" > .tmp-plex

echo "Removing triggers:"
cat .tmp-plex | sed 's/|.*//'
cat .tmp-plex | sed 's/|.*//' | xargs -I % sqlite3 com.plexapp.plugins.library.db "DROP TRIGGER %"
```

Then run the `plex-redate` command.

To _lock_ the database (reinstate those triggers) and reinsert it into the running Plex server,

```sh
#!/usr/bin/env bash

# Get the triggers list.
echo "Restoring triggers:"
cat .tmp-plex | sed 's/.*|//g'
cat .tmp-plex | sed 's/.*|//g' | xargs -I % sqlite3 com.plexapp.plugins.library.db "%"
rm .tmp-plex

echo "Restoring DB..."
cp com.plexapp.plugins.library.db ~/Library/Application\ Support/Plex\ Media\ Server/Plug-in\ Support/Databases/com.plexapp.plugins.library.db
echo "Copied DB back into Plex directory"
```
