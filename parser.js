'use strict';

const SCHEMA_TYPE_PATTERN = /^(?:https?:\/\/(?:www\.)?schema\.org\/)?([A-Za-z]+)\/?$/;

const MICRODATA_ACTION_SELECTOR = '[itemprop~="action"][itemscope], [itemprop~="potentialAction"][itemscope]';

function isSchemaType(value, expectedType) {
	const types = Array.isArray(value) ? value : [value];

	return types.some(type => typeof type === 'string' && SCHEMA_TYPE_PATTERN.exec(type.trim())?.[1] === expectedType);
}

function isSafeHttpUrl(value) {
	if(typeof value !== 'string') {
		return false;
	}

	try {
		const {protocol} = new URL(value);

		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
}

function deduplicateActions(actions) {
	const seen = new Set();

	return actions.filter(({name, url}) => {
		const key = JSON.stringify([name, url]);

		if(seen.has(key)) {
			return false;
		}

		seen.add(key);

		return true;
	});
}

function toViewAction(name, url) {
	return isSafeHttpUrl(url) ? [{type: 'ViewAction', name, url}] : [];
}

function parseMicrodataAction(element) {
	const urlElement = element.querySelector('[itemprop="url"]');
	const nameElement = element.querySelector('[itemprop="name"]');

	const url = urlElement?.getAttribute('href') ?? urlElement?.getAttribute('content');
	const name = nameElement?.getAttribute('content') ?? nameElement?.textContent.trim();

	return toViewAction(name ?? '', url);
}

function parseMicrodataActions(document) {
	return Array.from(document.querySelectorAll('[itemscope][itemtype]'))
		.filter(scope => isSchemaType(scope.getAttribute('itemtype'), 'EmailMessage'))
		.flatMap(scope => Array.from(scope.querySelectorAll(MICRODATA_ACTION_SELECTOR)))
		.filter(element => isSchemaType(element.getAttribute('itemtype'), 'ViewAction'))
		.flatMap(parseMicrodataAction);
}

function resolveJsonLdUrl(action) {
	const {url, target} = action;

	return url ?? (typeof target === 'string' ? target : target?.urlTemplate ?? target?.url);
}

function parseJsonLdNode(node) {
	if(Array.isArray(node)) {
		return node.flatMap(parseJsonLdNode);
	}

	if(!node || typeof node !== 'object') {
		return [];
	}

	if(!isSchemaType(node['@type'], 'EmailMessage')) {
		return parseJsonLdNode(node['@graph']);
	}

	return [node.potentialAction ?? node.action]
		.flat()
		.filter(action => isSchemaType(action?.['@type'], 'ViewAction'))
		.flatMap(action => toViewAction(typeof action.name === 'string' ? action.name : '', resolveJsonLdUrl(action)));
}

function parseJsonLdActions(document) {
	return Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(script => {
		try {
			return parseJsonLdNode(JSON.parse(script.textContent));
		} catch {
			return [];
		}
	});
}

function parseHtmlForActions(html) {
	const document = new DOMParser().parseFromString(html, 'text/html');

	return deduplicateActions([...parseMicrodataActions(document), ...parseJsonLdActions(document)]);
}

function extractActionsFromMessagePart(part) {
	const isHtml = part.contentType?.toLowerCase().startsWith('text/html') && typeof part.body === 'string';

	const ownActions = isHtml ? parseHtmlForActions(part.body) : [];
	const nestedActions = (part.parts ?? []).flatMap(extractActionsFromMessagePart);

	return deduplicateActions([...ownActions, ...nestedActions]);
}

async function extractActionsFromMessage(messageId) {
	return extractActionsFromMessagePart(await messenger.messages.getFull(messageId));
}

globalThis.EmailActionParser = {
	extractActionsFromMessage, extractActionsFromMessagePart, parseHtmlForActions,
};
