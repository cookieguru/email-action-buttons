import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
	beforeEach, describe, expect, test,
} from 'vitest';

import {
	JSDOM,
} from 'jsdom';


const MENU_CONTEXT = 'message_display_action_menu';

let listeners;
let menuItems;
let refreshCount;
let openedUrls;
let actionCalls;
let displayedMessage;
let messageBody;
let bodyFor;


function loadScript(context, fileName) {
	vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '..', fileName), 'utf8'), context);
}


function jsonLd(...actions) {
	return `<script type="application/ld+json">${JSON.stringify({
		'@type': 'EmailMessage',
		potentialAction: actions.map(action => ({'@type': 'ViewAction', ...action})),
	})}</script>`;
}


async function showMenu() {
	await listeners.onShown({menuIds: [], contexts: [MENU_CONTEXT]}, {id: 7});
}


beforeEach(() => {
	listeners = {};
	menuItems = [];
	refreshCount = 0;
	openedUrls = [];
	actionCalls = [];
	displayedMessage = {id: 42};
	messageBody = '';
	bodyFor = async () => messageBody;

	const dom = new JSDOM('<!doctype html><html><body></body></html>');

	const messenger = {
		messages: {
			getFull: async messageId => ({contentType: 'text/html', body: await bodyFor(messageId)}),
		},
		messageDisplay: {
			getDisplayedMessage: async () => displayedMessage,
			onMessagesDisplayed: {addListener: listener => { listeners.onDisplayed = listener; }},
		},
		messageDisplayAction: new Proxy({}, {
			get: (_, name) => async (...args) => { actionCalls.push([name, ...args]); },
		}),
		menus: {
			create: properties => { menuItems.push(properties); },
			removeAll: async () => { menuItems = []; },
			refresh: async () => { refreshCount++; },
			onShown: {addListener: listener => { listeners.onShown = listener; }},
			onClicked: {addListener: listener => { listeners.onClicked = listener; }},
		},
		tabs: {
			create: async ({url}) => { openedUrls.push(url); },
			onActivated: {addListener: listener => { listeners.onActivated = listener; }},
		},
	};

	const context = vm.createContext({
		messenger, console, DOMParser: dom.window.DOMParser, URL,
	});

	loadScript(context, 'parser.js');
	loadScript(context, 'background.js');
});


describe('Email Actions button state', () => {

	test('enables the button when the displayed message has actions', async () => {
		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		const names = actionCalls.map(call => call[0]);

		expect(names.lastIndexOf('enable')).toBeGreaterThan(names.lastIndexOf('disable'));
	});


	test('disables the button when the displayed message has no actions', async () => {
		messageBody = '<p>Hello</p>';

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		expect(actionCalls.map(call => call[0])).toContain('disable');
	});

});


describe('Email Actions button icon', () => {

	test('shows the hourglass before reading the message and the arrow afterwards', async () => {
		const iconsWhenRead = [];

		bodyFor = async () => {
			iconsWhenRead.push(actionCalls.findLast(call => call[0] === 'setIcon')?.[1].path);

			return jsonLd({name: 'View', url: 'https://example.com/1'});
		};

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		expect(iconsWhenRead).toEqual(['icons/hourglass.svg']);
		expect(actionCalls.findLast(call => call[0] === 'setIcon')).toEqual(['setIcon', {tabId: 7, path: 'icons/icon.svg'}]);
	});


	test('restores the arrow when the message has no actions', async () => {
		messageBody = '<p>Hello</p>';

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		expect(actionCalls.findLast(call => call[0] === 'setIcon')[1].path).toBe('icons/icon.svg');
	});


	test('restores the arrow when reading the message fails', async () => {
		bodyFor = async () => { throw new Error('unreadable'); };

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		expect(actionCalls.findLast(call => call[0] === 'setIcon')[1].path).toBe('icons/icon.svg');
	});


	test('a slow check of an earlier message does not end the hourglass of a newer check', async () => {
		let finishSlowCheck;
		const slowBody = new Promise(resolve => { finishSlowCheck = resolve; });

		bodyFor = () => slowBody;
		const slowSync = listeners.onDisplayed({id: 7}, [{id: 1}]);

		await new Promise(resolve => setTimeout(resolve));

		let finishNewCheck;
		const newBody = new Promise(resolve => { finishNewCheck = resolve; });

		bodyFor = () => newBody;
		const newSync = listeners.onDisplayed({id: 7}, [{id: 2}]);

		await new Promise(resolve => setTimeout(resolve));

		finishSlowCheck('<p>Stale</p>');
		await slowSync;

		expect(actionCalls.findLast(call => call[0] === 'setIcon')[1].path).toBe('icons/hourglass.svg');

		finishNewCheck('<p>Done</p>');
		await newSync;
	});


	test('never changes the label, so the toolbar does not shift', async () => {
		messageBody = '<p>Hello</p>';
		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});
		await listeners.onDisplayed({id: 7}, [{id: 43}]);

		expect(actionCalls.map(call => call[0])).not.toContain('setLabel');
	});

});


describe('Email Actions button never offers an empty menu', () => {

	test('starts disabled everywhere until a message has been checked', () => {
		expect(actionCalls[0]).toEqual(['disable']);
	});


	test('disables the button while the newly displayed message is being checked', async () => {
		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});
		await listeners.onDisplayed({id: 7}, [{id: 42}]);
		actionCalls.length = 0;

		await listeners.onDisplayed({id: 7}, [{id: 43}]);

		expect(actionCalls.map(call => call[0]).slice(0, 2)).toEqual(['disable', 'setBadgeText']);
	});


	test('disables the button when several messages are selected', async () => {
		displayedMessage = null;

		await listeners.onDisplayed({id: 7}, [{id: 42}, {id: 43}]);

		const names = actionCalls.map(call => call[0]);

		expect(names).toContain('disable');
		expect(names).not.toContain('enable');
	});


	test('a slow check of an earlier message cannot override a newer one', async () => {
		let finishSlowCheck;
		const slowBody = new Promise(resolve => { finishSlowCheck = resolve; });

		displayedMessage = {id: 1};
		bodyFor = () => slowBody;
		const slowSync = listeners.onDisplayed({id: 7}, [{id: 1}]);

		await new Promise(resolve => setTimeout(resolve));

		displayedMessage = {id: 2};
		bodyFor = async () => '<p>No actions</p>';
		await listeners.onDisplayed({id: 7}, [{id: 2}]);

		finishSlowCheck(jsonLd({name: 'Stale', url: 'https://example.com/stale'}));
		await slowSync;

		expect(actionCalls.map(call => call[0])).not.toContain('enable');
		expect(menuItems).toEqual([]);
	});


	test('prepares the menu before enabling the button', async () => {
		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});

		await listeners.onDisplayed({id: 7}, [{id: 42}]);

		expect(menuItems.map(item => item.title)).toEqual(['View (example.com)']);
	});


	test('rechecks the message when switching tabs', async () => {
		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});

		await listeners.onActivated({tabId: 9});

		expect(actionCalls).toContainEqual(['enable', 9]);
	});


	test('shows a disabled placeholder if the menu opens with no actions', async () => {
		messageBody = '<p>Hello</p>';

		await showMenu();

		expect(menuItems).toHaveLength(1);
		expect(menuItems[0].enabled).toBe(false);
		expect(actionCalls).toContainEqual(['disable', 7]);
	});

});


describe('Email Actions menu', () => {

	test('lists each action with its hostname and refreshes the open menu', async () => {
		messageBody = jsonLd({name: 'View Pull Request', url: 'https://github.com/org/repo/pull/1'});

		await showMenu();

		expect(menuItems).toHaveLength(1);
		expect(menuItems[0].title).toBe('View Pull Request (github.com)');
		expect(Array.from(menuItems[0].contexts)).toEqual([MENU_CONTEXT]);
		expect(refreshCount).toBe(1);
	});


	test('escapes ampersands so they are not treated as access keys', async () => {
		messageBody = jsonLd({name: 'Q&A', url: 'https://example.com/1'});

		await showMenu();

		expect(menuItems[0].title).toBe('Q&&A (example.com)');
	});


	test('replaces the items from the previously displayed message', async () => {
		messageBody = jsonLd({name: 'First', url: 'https://example.com/1'});
		await showMenu();

		messageBody = jsonLd({name: 'Second', url: 'https://example.com/2'});
		await showMenu();

		expect(menuItems.map(item => item.title)).toEqual(['Second (example.com)']);
	});


	test('ignores menus other than the Email Actions menu', async () => {
		messageBody = jsonLd({name: 'View', url: 'https://example.com/1'});

		await listeners.onShown({menuIds: [], contexts: ['message_list']}, {id: 7});

		expect(menuItems).toEqual([]);
		expect(refreshCount).toBe(0);
	});


	test('shows no clickable items when no single message is displayed', async () => {
		displayedMessage = null;

		await showMenu();

		expect(menuItems.filter(item => item.enabled !== false)).toEqual([]);
	});


	test('opens the URL of the clicked action', async () => {
		messageBody = jsonLd(
			{name: 'First', url: 'https://example.com/1'},
			{name: 'Second', url: 'https://example.com/2'},
		);
		await showMenu();

		await listeners.onClicked({menuItemId: menuItems[1].id});

		expect(openedUrls).toEqual(['https://example.com/2']);
	});

});
