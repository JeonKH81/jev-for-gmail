<p align="center"><img src="icons/icon128.png" width="96" alt="Jev for Gmail icon"></p>

# Jev for Gmail

[한국어](README.md) | **English**

Jev for Gmail is a Chrome extension that displays priority score badges beside messages in Gmail's **Primary** inbox. Scores are provided by TypeSafe's [Jev](https://typesafe.ai) model. Jev does not generate text; it answers predefined questions with probabilities and scores. The extension never changes Gmail messages, labels, or read status.

The interface automatically follows Chrome's language: Korean (`ko`) or English (the default for other languages).

![demo](docs/demo.png)
<sub>Example screen using fictional messages</sub>

## How scoring works

Jev answers four questions for each email:

| Question | Output |
|---|---|
| Does the recipient personally need to take action? | Probability, 0–1 |
| How urgent is it? | Score, 0–3 |
| How important is it to the recipient's role? | Score, 0–3 |
| Has it already been handled? | Probability, 0–1 |

**Priority = 0.4 × action + 0.3 × urgency/3 + 0.3 × importance/3.** The score is reduced when the message appears to have been handled already.

| Badge | Meaning |
|---|---|
| Red | 0.7 or higher |
| Orange | 0.5–0.7 |
| Gray | 0.3–0.5 |
| Light gray | Below 0.3, such as ads and newsletters |
| Green dashed ✓ | Appears to have been handled already |
| 🔒 | Patient-related or high-risk private information; not sent (hover to see why) |

Hover over a badge to see the component scores.

## Privacy and safety

- **Only a safety-checked subject and up to 2,500 characters from the latest part of the email are sent to TypeSafe servers in the United States.** Check your organization's privacy requirements before use.
- **Messages with clear high-risk data are not sent.** The extension locks patient procedure or surgery schedules, admission or patient rosters, patient tables containing fields such as registration number, date of birth and diagnosis, senders explicitly excluded by the user, explicit patient names or IDs, valid Korean resident registration numbers, card or account numbers, passport numbers, authentication secrets, and actual login credentials.
- Ordinary work words such as `patient`, `outpatient`, `participant`, `deposit`, `account`, or `address` do not lock a message by themselves. Email addresses, phone numbers, addresses, dates of birth, and ordinary numbers are masked locally before transmission.
- Raw sender names and email addresses are never included in TypeSafe requests. The sender is classified locally as `organization_internal`, `academic_organization`, `journal_platform`, `automated`, or `external`.
- Address headers such as `From`, `To`, `Cc`, `Bcc`, and `Reply-To`, as well as unlabelled sender name and email lines in Gmail's print view, are replaced locally with `[SELF]` or `[REDACTED]`. Address lines without street numbers are masked too. No external name-detection or NER service is used.
- A final safety scan runs after masking. If an email address, phone number, resident registration number, card or account number, passport number, address, patient ID, or another risky pattern remains, the entire message is locked and not sent.
- Only the de-identified role selected in Settings is sent. Email addresses entered under “My email addresses” are used locally only to identify `[SELF]` replies and are never sent to TypeSafe.
- The `already_handled` estimate can use `[SELF]` markers, expired deadlines, and locally retained follow-up confirmation rules.
- Hover over a 🔒 badge to see the specific lock reason.
- **The filter is not perfect.** Unrecognized private information may remain in a message.
- The API key is stored only in the user's browser using `chrome.storage.local`.
- This is not a medical device or clinical decision-support tool. Scores are only intended to help decide what to read first.

## Installation

1. Select **Code → Download ZIP** in this repository, then extract the archive. Do not move or delete the extracted folder after installation.
2. Enter `chrome://extensions` in Chrome's address bar.
3. Turn on **Developer mode** in the upper-right corner.
4. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Complete the Settings page that opens automatically, select **Save**, then **Test connection**:
   - TypeSafe API key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys)
   - De-identified role
   - Your email addresses, used only for local `[SELF]` replacement
   - Patient-related senders whose messages should always be locked; use `@domain` carefully because it locks the entire domain
6. Refresh Gmail. Scores will appear in the Primary inbox.

Use the toolbar icon to turn badges on or off, clear the local score cache, or open Settings.

## Scope and behavior

- Scores only messages from the last seven days in the **Primary** inbox.
- A scored message is cached locally and is not sent again unless the thread changes.
- Cached privacy decisions are invalidated automatically when the privacy policy or relevant settings change.
- Estimated cost is approximately USD $0.0001 per message, charged to the user's own TypeSafe credits.
- The message body is obtained through Gmail's print view. After headers are removed, identifiers are masked, and the final safety scan passes, only the latest portion within the 2,500-character limit is sent. Reading this view does not mark a message as read.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration and locale selection (Manifest V3) |
| `_locales/en`, `_locales/ko` | English and Korean interface text |
| `privacy.js` | Local high-risk detection, masking, and outbound validation |
| `content.js` | Reads the Gmail list, applies local privacy rules, and displays badges |
| `background.js` | Calls the Jev API and defines scoring questions |
| `options.html/js` | Settings page |
| `popup.html/js` | Toolbar popup |

## Permissions

Localization and the privacy fixes did not add permissions. The extension continues to request only local storage plus access to Gmail and the TypeSafe API.

## License

MIT
