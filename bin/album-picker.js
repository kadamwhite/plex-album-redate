import {
	createPrompt, useState, useKeypress, usePrefix, usePagination,
	isUpKey, isDownKey, isSpaceKey, isEnterKey,
} from '@inquirer/core';

// Checkbox list where Enter also ticks the highlighted row, and Esc resolves to [].
export const albumPicker = createPrompt( ( config, done ) => {
	const { choices, pageSize = 20, message } = config;
	const [ cursor, setCursor ] = useState( 0 );
	const [ ticked, setTicked ] = useState( new Set() );
	const prefix = usePrefix( {} );

	useKeypress( ( key ) => {
		if ( key.name === 'escape' ) {
			done( [] );
		} else if ( isEnterKey( key ) ) {
			const all = new Set( ticked ).add( cursor );
			done( choices.filter( ( _, i ) => all.has( i ) ).map( ( c ) => c.value ) );
		} else if ( isSpaceKey( key ) ) {
			const next = new Set( ticked );
			if ( next.has( cursor ) ) {
				next.delete( cursor );
			} else {
				next.add( cursor );
			}
			setTicked( next );
		} else if ( isUpKey( key ) ) {
			setCursor( ( cursor + choices.length - 1 ) % choices.length );
		} else if ( isDownKey( key ) ) {
			setCursor( ( cursor + 1 ) % choices.length );
		}
	} );

	const page = usePagination( {
		items: choices,
		active: cursor,
		pageSize,
		loop: true,
		renderItem: ( { item, index, isActive } ) => {
			const box = ticked.has( index ) ? '◉' : '◯';
			const line = `${ isActive ? '❯' : ' ' }${ box } ${ item.name }`;
			return isActive ? `\x1b[36m${ line }\x1b[39m` : line;
		},
	} );

	return `${ prefix } ${ message }\n${ page }\n\x1b[2mspace tick · enter select+submit · esc quit\x1b[22m`;
} );
