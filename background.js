'use strict';

const MENU_CONTEXT = 'message_display_action_menu';
const READY_ICON = 'icons/icon.svg';
const CHECKING_ICON = 'icons/hourglass.svg';

const urlsByMenuItemId = new Map();
const latestSyncByTab = new Map();

function formatMenuTitle({name, url}) {
	const label = `${name || 'View'} (${new URL(url).hostname})`;

	return label.replaceAll('&', '&&');
}

async function getDisplayedActions(tabId) {
	const message = await messenger.messageDisplay.getDisplayedMessage(tabId);

	return message ? EmailActionParser.extractActionsFromMessage(message.id) : [];
}

async function setMenuItems(actions) {
	await messenger.menus.removeAll();
	urlsByMenuItemId.clear();

	actions.forEach((action, index) => {
		const id = `action-${index}`;

		urlsByMenuItemId.set(id, action.url);
		messenger.menus.create({id, title: formatMenuTitle(action), contexts: [MENU_CONTEXT]});
	});
}

async function disableAction(tabId) {
	await messenger.messageDisplayAction.disable(tabId);
	await messenger.messageDisplayAction.setBadgeText({tabId, text: ''});
}

async function enableAction(tabId, actionCount) {
	await messenger.messageDisplayAction.enable(tabId);
	await messenger.messageDisplayAction.setBadgeText({tabId, text: String(actionCount)});
	await messenger.messageDisplayAction.setBadgeBackgroundColor({tabId, color: '#4A90E2'});
}

async function syncTab(tabId) {
	const syncId = (latestSyncByTab.get(tabId) ?? 0) + 1;

	latestSyncByTab.set(tabId, syncId);

	const isLatestSync = () => latestSyncByTab.get(tabId) === syncId;

	try {
		await disableAction(tabId);
		await messenger.messageDisplayAction.setIcon({tabId, path: CHECKING_ICON});

		const actions = await getDisplayedActions(tabId);

		if(!isLatestSync()) {
			return;
		}

		await setMenuItems(actions);

		if(actions.length) {
			await enableAction(tabId, actions.length);
		}
	} catch(error) {
		console.error('Email Action Buttons:', error);
	} finally {
		if(isLatestSync()) {
			await messenger.messageDisplayAction.setIcon({tabId, path: READY_ICON}).catch(console.error);
		}
	}
}

// The API cannot hide the button, so disabled means "nothing to offer"
messenger.messageDisplayAction.disable();

messenger.messageDisplay.onMessagesDisplayed.addListener(tab => syncTab(tab.id));

messenger.tabs.onActivated.addListener(({tabId}) => syncTab(tabId));

messenger.menus.onShown.addListener(async (info, tab) => {
	if(!info.contexts.includes(MENU_CONTEXT)) {
		return;
	}

	try {
		const actions = await getDisplayedActions(tab.id);

		await setMenuItems(actions);

		if(!actions.length) {
			messenger.menus.create({id: 'no-actions', title: 'No actions found', enabled: false, contexts: [MENU_CONTEXT]});
			await disableAction(tab.id);
		}

		await messenger.menus.refresh();
	} catch(error) {
		console.error('Email Action Buttons:', error);
	}
});

messenger.menus.onClicked.addListener(async ({menuItemId}) => {
	const url = urlsByMenuItemId.get(menuItemId);

	if(!EmailActionParser.isHttpsUrl(url)) {
		return;
	}

	try {
		await messenger.windows.openDefaultBrowser(url);
	} catch(error) {
		console.error('Could not open action URL:', error);
	}
});
