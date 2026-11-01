import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
	beforeAll, describe, expect, test,
} from 'vitest';

import {
	JSDOM,
} from 'jsdom';


let parser;

const fullMessages = new Map();


beforeAll(() => {
	const parserSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'parser.js'), 'utf8');

	const dom = new JSDOM('<!doctype html><html><body></body></html>');

	const context = vm.createContext({
		console,
		DOMParser: dom.window.DOMParser,
		URL,
		globalThis: {},
		messenger: {
			messages: {
				getFull: async messageId => fullMessages.get(messageId),
			},
		},
	});

	vm.runInContext(parserSource, context);

	parser = context.globalThis.EmailActionParser;
});


describe('Schema.org email action parser', () => {

	test('exports the parser API', () => {
		expect(parser).toBeDefined();

		expect(parser.parseHtmlForActions).toBeTypeOf('function');

		expect(parser.extractActionsFromMessagePart).toBeTypeOf('function');
	});


	test('parses the Zendesk microdata example', () => {
		const html = `
          <!doctype html>
          <html>
            <body>

              <p>
                Your support ticket has been updated.
              </p>

              <div
                itemscope=""
                itemtype="http://schema.org/EmailMessage"
                style="display:none">

                <div
                  itemprop="action"
                  itemscope=""
                  itemtype="http://schema.org/ViewAction">

                  <link
                    itemprop="url"
                    href="https://example.zendesk.com/hc/requests/12345">

                  <meta
                    itemprop="name"
                    content="View ticket">

                </div>
              </div>

            </body>
          </html>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toEqual([{
			type: 'ViewAction', name: 'View ticket', url: 'https://example.zendesk.com/hc/requests/12345',
		}]);
	});


	test('parses the GitHub JSON-LD example', () => {
		const html = `
          <!doctype html>
          <html>
            <body>

              <p>
                Someone commented on your issue.
              </p>

              <script type="application/ld+json">
              [
                {
                  "@context": "http://schema.org",
                  "@type": "EmailMessage",
                  "potentialAction": {
                    "@type": "ViewAction",
                    "target":
                      "https://github.com/org/repo/issues/123",
                    "url":
                      "https://github.com/org/repo/issues/123",
                    "name": "View Issue"
                  },
                  "description":
                    "View this Issue on GitHub",
                  "publisher": {
                    "@type": "Organization",
                    "name": "GitHub",
                    "url": "https://github.com"
                  }
                }
              ]
              </script>

            </body>
          </html>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toEqual([{
			type: 'ViewAction', name: 'View Issue', url: 'https://github.com/org/repo/issues/123',
		}]);
	});


	test('supports multiple GitHub actions', () => {
		const html = `
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "EmailMessage",
            "potentialAction": [
              {
                "@type": "ViewAction",
                "name": "View Issue",
                "url":
                  "https://github.com/org/repo/issues/123"
              },
              {
                "@type": "ViewAction",
                "name": "View Repository",
                "url":
                  "https://github.com/org/repo"
              }
            ]
          }
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toEqual([{
			type: 'ViewAction', name: 'View Issue', url: 'https://github.com/org/repo/issues/123',
		}, {
			type: 'ViewAction', name: 'View Repository', url: 'https://github.com/org/repo',
		}]);
	});


	test('supports HTTPS Schema.org URLs', () => {
		const html = `
          <div
            itemscope
            itemtype="https://schema.org/EmailMessage">

            <div
              itemprop="action"
              itemscope
              itemtype="https://schema.org/ViewAction">

              <link
                itemprop="url"
                href="https://example.com/ticket/123">

              <meta
                itemprop="name"
                content="View Ticket">

            </div>
          </div>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toHaveLength(1);

		expect(actions[0].name)
			.toBe('View Ticket');

		expect(actions[0].url)
			.toBe('https://example.com/ticket/123');
	});


	test('supports target when url is absent', () => {
		const html = `
          <script type="application/ld+json">
          {
            "@type": "EmailMessage",
            "potentialAction": {
              "@type": "ViewAction",
              "target":
                "https://example.com/ticket/123",
              "name": "View Ticket"
            }
          }
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toEqual([{
			type: 'ViewAction', name: 'View Ticket', url: 'https://example.com/ticket/123',
		}]);
	});


	test('supports an EntryPoint urlTemplate', () => {
		const html = `
          <script type="application/ld+json">
          {
            "@type": "EmailMessage",
            "potentialAction": {
              "@type": "ViewAction",
              "target": {
                "@type": "EntryPoint",
                "urlTemplate":
                  "https://example.com/ticket/123"
              },
              "name": "View Ticket"
            }
          }
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions).toHaveLength(1);

		expect(actions[0].url)
			.toBe('https://example.com/ticket/123');
	});


	test('rejects javascript URLs', () => {
		const html = `
          <script type="application/ld+json">
          {
            "@type": "EmailMessage",
            "potentialAction": {
              "@type": "ViewAction",
              "url":
                "javascript:alert(document.cookie)",
              "name": "Bad"
            }
          }
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions)
			.toEqual([]);
	});


	test('rejects file URLs', () => {
		const html = `
          <script type="application/ld+json">
          {
            "@type": "EmailMessage",
            "potentialAction": {
              "@type": "ViewAction",
              "url":
                "file:///etc/passwd",
              "name": "Bad"
            }
          }
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions)
			.toEqual([]);
	});


	test('deduplicates identical actions', () => {
		const html = `
          <script type="application/ld+json">
          [
            {
              "@type": "EmailMessage",
              "potentialAction": {
                "@type": "ViewAction",
                "url":
                  "https://example.com/123",
                "name": "View"
              }
            },
            {
              "@type": "EmailMessage",
              "potentialAction": {
                "@type": "ViewAction",
                "url":
                  "https://example.com/123",
                "name": "View"
              }
            }
          ]
          </script>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions)
			.toHaveLength(1);
	});


	test('returns no actions for ordinary email', () => {
		const html = `
          <!doctype html>
          <html>
            <body>
              <h1>Hello</h1>
              <p>
                This is an ordinary email.
              </p>
            </body>
          </html>
        `;

		const actions = parser.parseHtmlForActions(html);

		expect(actions)
			.toEqual([]);
	});


	test('decodes escaped ampersands in JSON-LD URLs', () => {
		const html = `
          <script type="application/ld+json">
          [{
            "@type": "EmailMessage",
            "potentialAction": {
              "@type": "ViewAction",
              "url": "https://github.com/org/repo/pull/1?a=1\u0026b=2#event-1",
              "name": "View Pull Request"
            }
          }]
          </script>
        `;

		expect(parser.parseHtmlForActions(html)).toEqual([{
			type: 'ViewAction', name: 'View Pull Request', url: 'https://github.com/org/repo/pull/1?a=1&b=2#event-1',
		}]);
	});


	test('ignores malformed JSON-LD but keeps later blocks', () => {
		const html = '<script type="application/ld+json">{ not json</script>' + htmlWithAction('https://example.com/1');

		expect(parser.parseHtmlForActions(html)).toHaveLength(1);
	});


	test('ignores actions outside an EmailMessage', () => {
		const html = htmlWithAction('https://example.com/1').replace('EmailMessage', 'WebPage');

		expect(parser.parseHtmlForActions(html)).toEqual([]);
	});


	test('finds actions in HTML nested inside multipart parts', () => {
		const part = {
			contentType: 'multipart/mixed',
			parts: [{
				contentType: 'multipart/alternative',
				parts: [{
					contentType: 'text/plain',
					body: 'Merged #387 into master.',
				}, {
					contentType: 'text/html',
					body: htmlWithAction('https://example.com/1'),
				}],
			}],
		};

		expect(parser.extractActionsFromMessagePart(part)).toEqual([{
			type: 'ViewAction', name: 'View', url: 'https://example.com/1',
		}]);
	});


	test('does not parse text/plain parts as HTML', () => {
		const part = {
			contentType: 'text/plain',
			body: htmlWithAction('https://example.com/1'),
		};

		expect(parser.extractActionsFromMessagePart(part)).toEqual([]);
	});


	test('deduplicates actions across parts', () => {
		const part = {
			contentType: 'multipart/mixed',
			parts: [{
				contentType: 'text/html',
				body: htmlWithAction('https://example.com/1'),
			}, {
				contentType: 'text/html',
				body: htmlWithAction('https://example.com/1'),
			}],
		};

		expect(parser.extractActionsFromMessagePart(part)).toHaveLength(1);
	});


	test('reads actions from a message by id', async () => {
		fullMessages.set(42, {
			contentType: 'text/html',
			body: htmlWithAction('https://example.com/42'),
		});

		expect(await parser.extractActionsFromMessage(42)).toEqual([{
			type: 'ViewAction', name: 'View', url: 'https://example.com/42',
		}]);
	});

});


function htmlWithAction(url) {
	return `
      <script type="application/ld+json">
      {
        "@type": "EmailMessage",
        "potentialAction": {
          "@type": "ViewAction",
          "url": "${url}",
          "name": "View"
        }
      }
      </script>
    `;
}
