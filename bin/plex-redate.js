#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { input, confirm } from '@inquirer/prompts';
import { albumPicker } from './album-picker.js';
import { parse as chrono } from 'chrono-node';

const ALBUM = 9;
const TRACK = 10;

const { values: opts } = parseArgs( {
	options: {
		db: { type: 'string', short: 'd' },
		limit: { type: 'string', short: 'n', default: '40' },
		search: { type: 'string', short: 's' },
		help: { type: 'boolean', short: 'h' },
	},
} );

if ( opts.help ) {
	console.log( `Usage: plex-redate --db <library.db> [--limit 40] [--search text]

Browse recently added albums, pick one or more, and set a new added_at.
Dates are free text, e.g. "Feb 2024", "2024-02-15", "8pm on February 15th, 2024, JST".
--db defaults to $PLEX_LIBRARY_DB, then to a Plex library .db found in the current directory.
A backup is written before the first change.` );
	process.exit( 0 );
}

// A Plex library DB is any SQLite file in cwd with a metadata_items table.
function findLocalDb() {
	const found = readdirSync( '.' ).filter( ( f ) => f.endsWith( '.db' ) ).filter( ( f ) => {
		try {
			const probe = new DatabaseSync( f, { readOnly: true } );
			const hit = probe.prepare( "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'metadata_items'" ).get();
			probe.close();
			return Boolean( hit );
		} catch {
			return false;
		}
	} );
	if ( found.length > 1 ) {
		console.error( `Several Plex DBs here, pass --db to choose: ${ found.join( ', ' ) }` );
		process.exit( 1 );
	}
	return found[ 0 ];
}

const dbPath = opts.db ?? process.env.PLEX_LIBRARY_DB ?? findLocalDb();
if ( ! dbPath || ! existsSync( dbPath ) ) {
	console.error( 'No Plex DB found in this directory. Pass --db <path> or set PLEX_LIBRARY_DB.' );
	process.exit( 1 );
}
console.log( `Using ${ dbPath }` );

const db = new DatabaseSync( dbPath );

const listAlbums = db.prepare( `
	SELECT a.id, a.title, a.added_at, a.parent_id, ar.title AS artist
	FROM metadata_items a
	JOIN metadata_items ar ON ar.id = a.parent_id
	WHERE a.metadata_type = ${ ALBUM }
	  AND ( ? IS NULL OR a.title LIKE ? OR ar.title LIKE ? )
	ORDER BY a.added_at DESC
	LIMIT ?
` );

const setAlbum = db.prepare(
	`UPDATE metadata_items SET added_at = ? WHERE id = ? OR ( parent_id = ? AND metadata_type = ${ TRACK } )`
);
const setArtist = db.prepare(
	'UPDATE metadata_items SET added_at = ? WHERE id = ? AND added_at > ?'
);


const fmt = ( ts ) => new Date( ts * 1000 ).toISOString().slice( 0, 10 );
// Abbreviations we can name. Anything else explicit falls back to a UTC offset.
const ZONES = {
	JST: 'Asia/Tokyo', KST: 'Asia/Seoul', HKT: 'Asia/Hong_Kong', SGT: 'Asia/Singapore',
	IST: 'Asia/Kolkata', AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney',
	GMT: 'Europe/London', BST: 'Europe/London', UTC: 'UTC',
	CET: 'Europe/Paris', CEST: 'Europe/Paris', EET: 'Europe/Athens', EEST: 'Europe/Athens',
	EST: 'America/New_York', EDT: 'America/New_York', CST: 'America/Chicago', CDT: 'America/Chicago',
	MST: 'America/Denver', MDT: 'America/Denver', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
	AKST: 'America/Anchorage', AKDT: 'America/Anchorage', HST: 'Pacific/Honolulu',
};

function zoneFromText( text ) {
	const m = text.toUpperCase().match( /\b([A-Z]{2,5})\b/g ) ?? [];
	return m.map( ( a ) => ZONES[ a ] ).find( Boolean ) ?? null;
}

function fmtOffset( offset ) {
	const sign = offset < 0 ? '-' : '+';
	const abs = Math.abs( offset );
	return `UTC${ sign }${ String( Math.floor( abs / 60 ) ).padStart( 2, '0' ) }:${ String( abs % 60 ).padStart( 2, '0' ) }`;
}

// Preview in the zone the user typed, if any; otherwise the system zone.
function fmtFull( { ts, offset, zone } ) {
	const d = new Date( ts * 1000 );
	if ( offset === null ) {
		return d.toString();
	}
	if ( zone ) {
		const opts = { timeZone: zone, dateStyle: 'full', timeStyle: 'short', hourCycle: 'h23' };
		const name = new Intl.DateTimeFormat( 'en-US', { timeZone: zone, timeZoneName: 'long' } )
			.formatToParts( d ).find( ( p ) => p.type === 'timeZoneName' ).value;
		return `${ new Intl.DateTimeFormat( 'en-US', opts ).format( d ) } (${ name })`;
	}
	const shifted = new Date( ( ts + offset * 60 ) * 1000 ).toISOString().slice( 0, 16 ).replace( 'T', ' ' );
	return `${ shifted } (${ fmtOffset( offset ) })`;
}

function parseDate( text ) {
	const r = chrono( text, new Date(), { forwardDate: false } )[ 0 ];
	if ( ! r ) {
		return 'Could not parse that date, try again';
	}
	const d = r.start.date();
	if ( d > new Date() ) {
		return 'That is in the future';
	}
	return {
		ts: Math.floor( d.getTime() / 1000 ),
		offset: r.start.isCertain( 'timezoneOffset' ) ? r.start.get( 'timezoneOffset' ) : null,
		zone: zoneFromText( text ),
	};
}

let backedUp = false;
function backupOnce() {
	if ( backedUp ) {
		return;
	}
	const stamp = new Date().toISOString().replace( /[:.]/g, '-' );
	const dest = `${ dbPath }.bak-${ stamp }`;
	copyFileSync( dbPath, dest );
	console.log( `Backup written: ${ dest }` );
	backedUp = true;
}

while ( true ) {
	const like = opts.search ? `%${ opts.search }%` : null;
	const albums = listAlbums.all( like, like, like, Number( opts.limit ) );
	if ( albums.length === 0 ) {
		console.log( 'No albums matched.' );
		break;
	}

	const picked = await albumPicker( {
		message: 'Recently added albums',
		pageSize: 20,
		choices: albums.map( ( a ) => ( {
			name: `${ fmt( a.added_at ) }  ${ a.artist } — ${ a.title }`,
			value: a,
		} ) ),
	} );
	if ( picked.length === 0 ) {
		break;
	}

	const when = await input( {
		message: `New added date for ${ picked.length } album(s):`,
		validate: ( v ) => ( typeof parseDate( v ) === 'object' ? true : parseDate( v ) ),
	} ).then( parseDate );
	const ts = when.ts;

	console.log( picked.map( ( a ) => `  ${ a.artist } — ${ a.title }` ).join( '\n' ) );
	const ok = await confirm( {
		message: `Set these to ${ fmtFull( when ) }?`,
		default: true,
	} );
	if ( ! ok ) {
		continue;
	}

	backupOnce();
	db.exec( 'BEGIN' );
	for ( const album of picked ) {
		const rows = setAlbum.run( ts, album.id, album.id ).changes;
		const artistMoved = setArtist.run( ts, album.parent_id, ts ).changes;
		console.log(
			`${ album.title }: ${ rows } rows (album + tracks)${ artistMoved ? ', artist moved too' : '' }`
		);
	}
	db.exec( 'COMMIT' );
}

db.close();
