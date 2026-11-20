# hukumado

English | [日本語](README.md)

A Chrome / Edge extension for watching up to 16 YouTube streams side by side on one screen.
Each tile can show its live chat as scrolling comments (danmaku), or open the chat panel next to the video so you can post.
It uses the YouTube account you are signed in to in the browser, so members-only streams work too.

This is an unofficial tool made by an individual. Please read the [Disclaimer](#disclaimer) before using it.

## Features

- **Split view**: uniform, main + sub and PinP (small windows inside the main tile) layouts. Every tile is sized to 16:9 automatically
- **Danmaku / chat panel**: show each tile's live chat as scrolling comments, or open it next to the video to post
- **Channels**: lists live and upcoming streams and recently ended streams of the channels you added (some channels are included as initial data. You can remove or restore them all at once in ⚙ Settings)
- **Auto play**: lays out live channels automatically and adds / removes tiles as streams start and end
- **🎲 Surprise me**: a button on empty tiles adds one stream not shown yet (pickup live → other live → recent streams). Auto play can also play recent streams when nothing is live
- **Pickup**: limit auto play and notifications to the channels you are following right now (e.g. the members of a group event)
- **Notifications / watch history / watch later**: notifications when streams start, a history of what you watched, and streams to watch later (🔖; play them in order in the current tiles, removed once watched to the end)
- **Japanese / English**: follows the browser language (can be fixed in settings)

## Requirements

- Google Chrome / Microsoft Edge 128 or later (Manifest V3)

## Install

It is not on the Chrome Web Store, so load it in developer mode.

1. Download `hukumado-x.y.z.zip` from the [releases page](https://github.com/contee213/hukumado/releases/latest) and extract it
2. Open `chrome://extensions` in Chrome (`edge://extensions` in Edge)
3. Turn on "Developer mode" at the top right
4. Click "Load unpacked" and choose the extracted folder (the one with `manifest.json` in it)
5. Click the hukumado icon in the toolbar (pin it from the puzzle-piece menu) to open the multi-view page

To update, extract the new zip over the same folder, press "⟳" for the extension on the extensions page, then reload the multi-view page
(if you move the folder, it is treated as a different extension and your settings and channels are not carried over).

## Quick start

1. Open the multi-view page with the hukumado icon in the toolbar
2. Press "Auto play" at the top to lay out the channels that are live
3. To pick yourself, paste a URL / video ID / `@handle` into an empty tile, or use "📺 Pick from channels" for live streams and "📚 Pick from library" for past ones
4. Switch which tile plays audio with 🔊 on the tile bar or the number keys (`1`–`9`)
5. Change the arrangement from "▦ Layout" at the top

For more controls and keys, open "?" (help) at the top right. The tour shown the first time you open it after installing can be replayed from there too. Settings are under "⚙".

> [!TIP]
> - If a channel you want isn't listed, add it from the field at the bottom of the "📺 Channels" window
> - To show only certain channels, pick them up with 📌 and set "Auto play plays" in ⚙ Settings to "Pickup (📌) only"
> - To watch more than 16, open another one in a separate window (auto play skips streams shown in another tab)

## Permissions and privacy

| Permission | Used for |
|---|---|
| `storage` | Saving settings, tile contents and channels in the browser |
| `declarativeNetRequestWithHostAccess` | The header change described below |
| `https://www.youtube.com/*` | Showing watch pages and live chat in tiles, getting channel info and live status |
| `https://schedule.hololive.tv/*` | Getting the stream schedule of the initial data channels |

- It only talks to YouTube and the schedule site. No data is sent to any other server
- Requests to YouTube use the browser's cookies (your sign-in). This is needed to show members-only streams and, in auto play, to check whether you can watch them
- YouTube watch pages and live chat forbid embedding in other pages with the `X-Frame-Options` header, so a rule that removes this header
  (a declarativeNetRequest session rule) is registered **only for the multi-view page's tab**.
  Other headers are left as they are, and the rule is removed when the tab closes or moves to another page
- Scripts and CSS that run inside the YouTube pages in the tiles only work inside tiles of the multi-view page, whose URLs carry `hukumado=1`.
  They don't affect normal YouTube browsing

## Limitations

- More tiles means more load. Adjust the number of tiles to your PC (the max tiles for auto play can be changed in settings)
- For the initial data channels, surprise streams that aren't on the schedule site may not show as "Live"
- For archives (after a stream ends), YouTube's chat replay is shown as danmaku and in the chat panel. Streams without a chat replay (e.g. chat was turned off) show nothing
- The initial data channels reflect information as of November 2026
- Only Japanese and English are available. Other browser languages are shown in English

## Development notes

- `extension/` is the extension itself. Main files: `grid.*` (multi-view page), `favorites.js` (channels and live status),
  `layouts.js` (layouts), `content/` (scripts that run in the YouTube pages inside tiles)
- Main + sub layouts are computed by `tools/gen-layouts.js` and written to `extension/layouts-generated.js`.
  After changing the rules, regenerate them with `node tools/gen-layouts.js`
- Versions: `version` in `manifest.json` is the release version. `version_name` adds a build number (the commit count) and the date,
  and is shown at the bottom of the help (?) and settings (⚙) windows. A hook (`.githooks/pre-commit` → `tools/stamp-version.js`) writes `version_name` on every commit.
  After cloning, run `git config core.hooksPath .githooks` once (Node.js is required)
- Releases: bump `version` in `manifest.json`, commit, and push a tag with the same number (e.g. `v0.2.0`).
  GitHub Actions (`.github/workflows/release.yml`) zips the contents of `extension` and creates the release. It stops if the tag and `version` differ
- For development, `git clone` the repository and load the `extension` folder to try changes right away
- The embed player (`youtube.com/embed`) refuses to play from extension pages (error 152), so tiles use the regular watch page

## Disclaimer

- This is an unofficial tool made by an individual. It is not affiliated with YouTube / Google or with the operators of the channels included as initial data,
  so please do not contact them about it
- It is provided "as is", without warranty of any kind
- The developer is not liable for any damage arising from using or being unable to use this tool
  (including restrictions or suspension of your account, data loss, load on your PC or network, or missed streams)
- Check the YouTube Terms of Service and guidelines, and use it at your own risk
- Some features may stop working without notice when YouTube or the schedule site changes its pages. Fixes or support are not promised

## License

[MIT License](LICENSE)

Channel names and icons (URLs to images on YouTube) in the initial data belong to each channel / rights holder.
