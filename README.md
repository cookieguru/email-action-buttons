# Email Action Buttons

[![Get the add-on for Thunderbird](https://raw.githubusercontent.com/thunderbird/webext-support/dd07ed6284c8b2d471d1b8de86e776cad1ec3a8c/images/get-the-addon.svg)](https://addons.thunderbird.net/thunderbird/addon/email-action-buttons/)

Thunderbird extension that detects Schema.org EmailMessage/ViewAction
metadata in email messages.

![The Email Actions menu listing View Pull Request (github.com) on a GitHub notification](https://addons.thunderbird.net/user-media/previews/full/209/209523.png)

## Supported formats

### HTML Microdata

Example:

```html
<div itemscope itemtype="http://schema.org/EmailMessage">
  <div itemprop="action" itemscope itemtype="http://schema.org/ViewAction">
    <link itemprop="url" href="https://example.com/ticket/123">
    <meta itemprop="name" content="View ticket">
  </div>
</div>
```

### JSON-LD

Example:

```html
<script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "EmailMessage",
  "potentialAction": {
    "@type": "ViewAction",
    "target": "https://example.com/ticket/123",
    "url": "https://example.com/ticket/123",
    "name": "View ticket"
  }
}
</script>
```

Arrays of JSON-LD objects are also supported.

## Requirements

Thunderbird 115 or later.

## Building locally

Requires Node.js 24.15.0 or later.

```sh
npm ci
npm run package:xpi
```

The XPI is written to `dist/email-action-buttons-<version>.xpi`, where
`<version>` comes from `manifest.json`. An existing file with the same name is
overwritten.

## Installation

In Thunderbird's Add-ons Manager, open the gear menu, choose
"Install Add-on From File...", and select the XPI.

## Usage

Open an email containing Schema.org EmailMessage/ViewAction metadata.

The "Email Actions" button in the message display toolbar shows an hourglass while
the message is checked. It is then enabled if the message has actions, and disabled
otherwise, because Thunderbird does not let extensions hide the button for individual
messages.

Click it to see the discovered actions in a menu, labelled with the hostname each
one opens.

Each action opens its URL in a new Thunderbird tab.

## Security

Only https:// URLs are accepted.

javascript:, data:, file:, and other protocols are rejected.
