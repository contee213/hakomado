# hukumado

English | [日本語](README.md)

A Chrome / Edge extension for watching up to 16 YouTube streams side by side on one screen.
Each tile can show its live chat as scrolling comments (danmaku), or open the chat panel next to the video so you can post.
It uses the YouTube account you are signed in to in the browser, so members-only streams work too.

> [!NOTE]
> This is an unofficial tool made by an individual. It is not affiliated with YouTube / Google or COVER Corporation (hololive).
> Some features may stop working when YouTube or the hololive schedule site changes its pages.
> Please use it at your own risk, in line with the YouTube Terms of Service.

## Features

- **Split view**: uniform grids (9 sizes from 1×1 to 4×4 that make good use of the screen) and big main tiles + small sub tiles (1, 2, 4, 6 or 8 main tiles; 23 combinations such as 1+5, 2+8B, 8+4)
  - Tiles are sized automatically so every tile is exactly 16:9 (no black bars). A "Fill screen" mode is also available
  - Drag to swap tiles (no reload). Any single tile can go fullscreen
- **Danmaku**: each tile's live chat scrolls from right to left. Emoji, member stamps and Super Chats are supported
- **Chat panel**: shown beside the tile, and you can post from it. Text size and width are adjustable
- **Audio**: normally one tile plays audio (shown by an outline around the tile and in the top bar). You can also listen to several tiles at once with each player's speaker button
- **Favorites**: 67 current hololive talents and 8 official channels are included from the start. Live and upcoming streams are listed
- **Auto play**: plays every favorite that is live, adds a tile when a stream starts and removes it when it ends. Streams starting soon get a tile before they start, and upcoming streams are shown when nothing is live. Members-only streams you can't watch are skipped (can be turned off)
- **Cruise**: at a set interval, moves the main tile and audio to the next stream so you can watch many streams a little at a time
- **Japanese / English**: follows the browser language (English for anything other than Japanese). You can also pick a language in Settings

## Requirements

- Google Chrome / Microsoft Edge 111 or later (Manifest V3)

## Install

It is not on the Chrome Web Store, so load it in developer mode.

1. Download this repository (Code → Download ZIP and extract it, or `git clone`)
2. Open `chrome://extensions` in Chrome (`edge://extensions` in Edge)
3. Turn on "Developer mode" at the top right
4. Click "Load unpacked" and choose the `extension` folder
5. Click the hukumado icon in the toolbar (pin it from the puzzle-piece menu) to open the multi-view page

After updating, press "⟳" for the extension on the extensions page, then reload the multi-view page.

## Usage

### Top bar

The left side controls what you see and how it flows (layout, auto play, cruise, danmaku, current audio); favorites, fullscreen and settings are on the right.
The current-audio button changes width with the channel name, so it is last on the left, and the layout name has a fixed width, so the other buttons never shift.

| Button | What it does |
|---|---|
| ▦ layout name | Choose a layout and how tiles fit the screen |
| ＋ / − | Add a tile / remove an empty tile. The layout changes to fit the number of tiles (see below) |
| ▶ Auto play | Keeps playing every live favorite (see below). Blue when ON |
| 🚢 Cruise | Moves the main tile and audio to the next stream at a set interval (see below). While ON, the button fills with blue from left to right and switches when full |
| ≋ Danmaku | Danmaku on all tiles (blue when ON) |
| 🔊 number name | The tile playing audio. Click to mute ⇄ restore the previous audio |
| ★ Favorites | Your favorites and their live status |
| ⛶ | Fullscreen with all tiles (the top bar hides; move the mouse to the top edge to show it. Esc to exit) |
| ⚙ / ? | Settings / help and keyboard shortcuts |

In a narrow window, labels are dropped and only icons remain (hover a button for its description).
In browser fullscreen (F11) the top bar also hides and appears when you move the mouse to the top edge.
If you fullscreen one tile with its ⛶ while in all-tiles fullscreen, Esc takes you back to all-tiles fullscreen.

### Tiles

- Paste a URL / video ID / `@handle` into an empty tile and press "Load" (for a channel, its current live stream opens).
  You can also use "★ Pick from favorites"
- Hover a tile to show its control bar: the tile number and name on the left, actions on the right

| Button | What it does |
|---|---|
| ⠿ | Drag to swap with another tile |
| 🔇 / 🔊 | Play audio only from this tile (others are muted) |
| 💬 | Show the chat panel to the right of the tile (you can post from it) |
| ≋ | Danmaku on this tile |
| ★ | Add this tile's channel to favorites |
| ⟳ | Reload (if the video or chat misbehaves) |
| ⛶ | Watch this tile in fullscreen (plays its audio; Esc returns to the previous audio) |
| ✕ | Close the tile |

💬 and ≋ are blue when ON. In small tiles the name is hidden and the buttons wrap onto two rows so they all stay clickable.

### Layouts

- Choose from "▦ layout" at the top. Tiles are numbered main → sub, and the stream in tile 1 stays in position 1 when you change layouts
- The list is split into Uniform and Main + sub (fewest main tiles first). Names are "mains+subs" (e.g. 2+8B = 2 main tiles and 8 sub tiles).
  Layouts with 2 or 6 main tiles come in two forms: mains side by side with subs below (ending in B) and mains stacked with subs on the right (ending in R).
- "＋" at the top adds a tile. The layout changes to one that fits the current count + 1 (chosen the same way as auto play); current streams keep their order and an empty tile is added at the end.
  There are no layouts with exactly 7 or 11 tiles, so 6 → 8 or 10 → 12 adds two empty tiles. It is disabled at 16 tiles
- "−" removes empty tiles (tiles with no stream loaded) from the end and switches to a layout with fewer tiles. The ✕ on an empty tile removes that tile.
  Tiles with a stream are never removed, and the buttons are disabled when the loaded streams would no longer fit (e.g. 7 streams in 1+7)
  Since 16:9 tiles are wide, stacked mains are closer together (about 0.56x the distance), so your eyes move less when watching both
- At the top right you can choose how tiles fit
  - **Fit 16:9** (default): no black bars inside tiles. If the screen and layout ratios differ, the leftover space becomes outer margins.
    The % in the list is how much of the current screen the video uses (green at 90% or more)
  - **Fill screen**: fills the screen with no margins; videos are zoomed to their tiles and the edges are cropped

### Favorites

- Open with "★ Favorites" (`F`). "● Live" and "Upcoming" are at the top, everything else below
  - Click an entry to load it (into the tile you opened favorites from, or an empty tile when opened from the top bar)
  - Filter by name / @handle in the top field; add an `@handle` / channel URL / video URL in the bottom field
  - "Fill empty tiles" in the "● Live" header puts live channels that aren't shown yet into empty tiles
- Built-in channels can be removed with ✕ (they don't come back on their own; use "Restore removed hololive channels")
- Live status is cached for 1 minute. Press "⟳ Refresh" to check again
- In English, built-in hololive channels are shown with their English names

### Auto play

Turn on "▶ Auto play" (`L`) to keep playing every favorite that is live (up to 16).

- When turned ON: every live stream is played in a layout that fits the count (layouts that are exactly filled are preferred, e.g. 5 → 2+3, 6 → 1+5, 10 → 1+9, 14 → 2+12B; it depends on the screen ratio).
  Streams already shown are kept on the tile 1 (main) side without reloading, and tiles that aren't live are cleared
- While ON: it checks every minute, adds a tile at the end (sub side) when a stream starts, and removes the tile and rearranges the layout when a stream ends
  - To avoid removing tiles because of a temporary miss, a tile is removed only after the stream is missing twice in a row. Nothing is removed when fetching fails
  - Tiles you loaded yourself with a URL while ON are never removed
- Streams you close with ✕ while ON are not added back. Turn it OFF → ON to add them again
- Turning it OFF keeps the current tiles and just stops adding / removing
- **Tiles for upcoming streams**: from 30 minutes before the start (⚙ Settings → Auto play: Off / 5 / 10 / 15 / 30 / 60 min), a tile is prepared for an upcoming stream.
  When it starts, the same tile switches to the stream, so you can watch from the very beginning. A stream that starts a little late stays for a while (up to 30 minutes past its scheduled time for streams on the hololive schedule)
- **When nothing is live**: all upcoming streams starting within an hour are shown. If there are none, the next upcoming stream is shown (all of them if several start at the same time).
  They are replaced once streams go live
- Members-only streams you are not a member of are skipped (toggle in ⚙ Settings → Auto play; ON by default).
  Before adding a stream, it checks on the watch page whether the signed-in account can watch it. If that can't be determined, the stream is added and
  then removed once the tile's player reports that it is members-only. Tiles you loaded yourself are never removed

### Cruise

Turn on "🚢 Cruise" (`C`) to rotate the shown streams one step at a set interval (2 minutes by default; 10 seconds to 30 minutes in ⚙ Settings → Auto play). It also works with tiles you arranged yourself, without auto play.

- In main + sub layouts, the first sub tile moves to the main tile and the previous main stream goes to the last sub tile. Audio follows the main tile (tile 1)
- In uniform layouts the order stays the same and only the audio moves to the next tile
- Empty tiles are skipped, and turning cruise on does not change the layout
- Together with auto play, main + sub layouts are preferred when auto play rearranges tiles (as streams start and end)
- Streams are never reloaded (only tile positions change). If everything is muted, only the order rotates and no audio is turned on
- Switching audio or swapping tiles yourself restarts the countdown. Cruise pauses while a single tile is fullscreen

### Audio

- The tile playing audio has an outline, and the top bar shows "🔊 number channel name"
- The extension's controls (a tile's 🔊 / number keys / fullscreen) play audio from that tile only and mute the rest
- The speaker button in a tile's YouTube player toggles only that tile (other tiles are unchanged — for listening to several at once)
- The top-bar button (`M`) mutes ⇄ restores the previous audio
- Muting here is not saved to your normal YouTube volume setting

### Settings (⚙)

- **Danmaku**: scroll time, text size, opacity, area, max on screen, author names, Super Chat highlight
  - The area is set by position (top / middle / bottom) and height (how much of the tile to use). Besides the preview in Settings, the band is shown on every tile while you adjust it
- **Audio outline**: color of the outline around the tile playing audio (Sky / Pink / Orange / Green / Purple / White), width, glow, animation.
  The audio indicator in the top bar is always the same blue as other ON buttons, regardless of the outline color
- **Chat**: text size, width, author icons
- **Auto play**: whether to skip members-only streams, how early to prepare tiles for upcoming streams, cruise interval
- **Display language** (top right of Settings): Auto (browser language) / 日本語 / English. Changing it reloads the page (your tiles come back as they were)

Settings and tile contents are saved in the browser (see "Reopening and multiple windows" below).

### Reopening and multiple windows

- Tiles, layout, fit mode, auto play and cruise are saved per tab (window) as a "viewing session".
  Settings (⚙) and favorites are shared by all tabs, and changes apply to the other tabs right away
- When you open the page, you can choose a previous session that isn't in use in another tab
  - **Continue where you left off** (with several sessions, "Resume this" for each) / **Start fresh** / **Start with auto play**
  - Each session shows the date, layout, count and stream names (up to 5; the rest as "N more")
  - Which stream was in which tile (the order) and which tiles had audio on (or that everything was muted) are restored too, so you can recover a tab you closed by accident
  - In the list, streams that had audio on are marked with 🔊
  - Reloading the same tab continues without asking
- To watch on several displays, open hukumado in separate windows to show different streams in each.
  The toolbar icon opens a new tab every time (several tabs in the same window are separate viewing sessions too)
- Auto play runs per tab. If it is ON in two windows, the same streams appear in both
- Up to the 8 most recent sessions are kept (empty and old ones are removed first)

### Keyboard

| Key | What it does |
|---|---|
| `1`–`9` | Play audio only from that tile |
| `Shift` + `1`–`9` | Fullscreen that tile |
| `Shift` + `F` | Fullscreen with all tiles |
| `M` | Mute ⇄ restore the previous audio |
| `D` | Danmaku on all tiles ON / OFF |
| `F` | Open favorites |
| `L` | Auto play ON / OFF |
| `C` | Cruise ON / OFF |
| `?` | Open help and keyboard shortcuts |

## Permissions and privacy

| Permission | Used for |
|---|---|
| `storage` | Saving settings, tile contents and favorites in the browser |
| `declarativeNetRequestWithHostAccess` | The header change described below |
| `https://www.youtube.com/*` | Showing watch pages and live chat in tiles, getting channel info and live status |
| `https://schedule.hololive.tv/*` | Getting the hololive stream schedule |

- It only talks to YouTube and the hololive schedule site. No data is sent to any other server
- Requests to YouTube use the browser's cookies (your sign-in). This is needed to show members-only streams and, in auto play, to check whether you can watch them
- YouTube watch pages and live chat forbid embedding in other pages with the `X-Frame-Options` header, so a rule that removes this header
  (a declarativeNetRequest session rule) is registered **only for the multi-view page's tab**.
  Other headers (such as Content-Security-Policy) are left as they are, and the rule is removed when the tab closes
- Inside the YouTube pages in the tiles, CSS that hides everything but the player and scripts that handle muting and read the chat run.
  They only work inside tiles of the multi-view page, whose URLs carry `hukumado=1`

## How it works

```
extension/
├── manifest.json
├── background.js        Opens the multi-view page; registers the X-Frame-Options rule for its tab only
├── i18n.js              Display language (Japanese / English) and UI text
├── _locales/            Extension name and description (ja / en; other languages use en)
├── grid.html / .css / .js   Multi-view page (tiles, layouts, audio, favorites, auto play, cruise, settings, viewing sessions)
├── layouts.js           Layout definitions and the column / row sizes that make every tile 16:9
├── danmaku.js           Danmaku rendering (assigns comments to non-overlapping rows)
├── favorites.js         Saving favorites and getting live status (hololive schedule / YouTube)
├── presets.js           Built-in favorites (hololive, with English names for display)
├── icons/               Icons (icon.svg is the source; PNGs are exported at 16 / 32 / 48 / 128 px)
└── content/
    ├── watch.js / watch.css   Shows only the player on the tile's watch page and talks to the parent page
    ├── watch-main.js          Mutes through the YouTube player API and reports whether the video can be played (members-only etc.; runs in the page)
    └── chat.js                Reads new comments from the tile's live chat and sends them to the parent page
data/
└── hololive-channels.json   Channel list researched for the built-in favorites (including graduated talents)
```

- The embed player (`youtube.com/embed`) refuses to play from an extension page (error 152), so tiles use the regular watch page
- Live status for hololive channels comes from one fetch of the [hololive schedule](https://schedule.hololive.tv/lives),
  and each stream's channel is looked up with YouTube oEmbed. Other channels are checked individually through their YouTube `/live` page

## Limitations

- More tiles means more load. Adjust the number of tiles to your PC
- Surprise streams that aren't on the hololive schedule may not show as "Live" in favorites or auto play
- Chat replay of archives (after a stream ends) is not supported for danmaku
- The built-in favorites (`presets.js`) reflect the official site as of November 2026
- Only Japanese and English are available. Other browser languages are shown in English

## License

[MIT License](LICENSE)

Channel names and icons (URLs to images on YouTube) in the built-in favorites belong to each channel / rights holder.
