# Polymarket UI: implementation spec (React + plain CSS)

Captured 2026-11-01 from polymarket.com, logged out, with a US geo (the view-only modal was dismissed). Captured at viewports of 1440x900, 1000x800 and 390x844. Computed styles were read with `getComputedStyle`, and tokens were dumped from the CSS custom properties.
Dark theme is the default (`<html data-theme="dark">`). All px values below come from dark theme unless they are marked as light.
**Fact vs inference:** values without a tag were measured. `(inf)` marks an inference or a reconstruction from memory.
**Geo caveats:** because of the US geo, the header showed "Go to polymarket.us" instead of Log in / Sign up. Those two buttons exist in the DOM but are hidden, and their styles are recorded below. `/portfolio` needs a login, so the portfolio layout was taken from the public profile page `/@user`, which uses the same components.
Do not copy their logo SVG, icons or copy. Use your own wordmark and an icon set such as Lucide.

---

## 1. Design tokens

### 1.1 Typography
- **Primary font:** `Inter` as a variable font. Weights are used in odd steps: 400/440/490/500/540/580/590/600/700. Feature settings: `"cv01","cv02","cv03","cv04","cv11","cv15","calt","liga"`.
  - Free equivalent: Google Fonts `Inter` (variable, `wght@400..700`). Use `font-feature-settings:"cv11","calt"`.
- **Monospace:** `Geist Mono` 13px/600, used for the `/` keyboard hint in search. The Google Fonts `Geist Mono` is the equivalent.
- **Secondary:** an `Open Sauce` font is loaded for some promo tiles. It is optional; Inter at 600 covers it.
- **Chart axis text:** Arial 12px, fill `#b6bbc4`.
- **Body:** 16px/24px. `-webkit-font-smoothing: antialiased`.

| Role | size/line-height | weight |
|---|---|---|
| Page H1 (Leaderboard) | 32/36 | 600 |
| Event title H1 | 24/28 | 600 |
| Hero/featured title | 24/32 | 600 |
| "% chance" on event (binary) | 24/32 | 600, brand blue |
| Section H2 ("All markets") | 20/24 | 600 |
| Sidebar H2 ("Breaking News") | 18/27 | 580 |
| Trade panel amount input | 40/60 | 600 |
| Outcome row % (event page) | 28/28 | 600 |
| Card title H3 | 14/20 | 590 |
| Card outcome name | 14/20 | 440 |
| Card outcome % | 15/22.5 | 600 |
| Tabs / tab bar | 14/20, inactive 400, active 600 | |
| Button label | 14/20 | 600 |
| Meta (volume, timestamps) | 13/16 | 490–500 |
| Small label ("chance", chip) | 12/16 | 600 |
| Order book column headers | 10/15 | 600, uppercase |

### 1.2 Color: raw ramps (light | dark). Prefix `--pk-`.
Gray: 50 `#ffffff`|`#0c0e13` · 100 `#f4f5f7`|`#1c1f27` · 200 `#e6e8ec`|`#2d3037` · 300 `#d4d7dc`|`#45474e` · 400 `#bfc3ca`|`#62646a` · 500 `#abb2bb`|`#7d8189` · 600 `#8b929b`|`#999ea7` · 700 `#6b727b`|`#b6bbc4` · 800 `#454a52`|`#d2d4d9` · 900 `#23272d`|`#edeff1` · 950 `#000`|`#fff`

Brand: 50 `#f4fcff`|`#020041` · 100 `#cadfff`|`#060071` · 200 `#a0c1ff`|`#0d00a8` · 400 `#4e7fff`|`#1e44e7` · **500 `#2e5cff`|`#3262ff`** · 600 `#1c3fe2`|`#5485ff` · 700 `#0f1ac6`|`#7ba5ff`

Green: 50 `#e4ffe9`|`#001300` · 100 `#cdf3d7`|`#002900` · 200 `#8fe5a5`|`#004108` · 300 `#3ad26d`|`#005b15` · 400 `#04af52`|`#007723` · 500 `#009c39`|`#009431` · 600 `#007e26`|`#00ae4b` · 700 `#006118`|`#2dca65` · 800 `#00450a`|`#53e67f`

Red: 50 `#fff6f2`|`#260000` · 100 `#ffcfc6`|`#480000` · 200 `#ffa597`|`#5d0101` · 300 `#ff7464`|`#950000` · 400 `#fe3d33`|`#bf0000` · 500 `#df0c10`|`#df0b10` · 600 `#bc0000`|`#fe3d32` · 700 `#930000`|`#ff7767`

Yellow 500 `#eab308`. Purple 500 `#8f3dd7`|`#9645df`. Teal 500 `#0088a7`.

### 1.3 Color: semantic tokens (use these in components)
```css
:root,[data-theme=light]{
  --bg:#ffffff;            /* surface: page bg */
  --surface:#ffffff;       /* elevated: cards (light cards = white + ring shadow) */
  --surface-2:#f4f5f7;     /* grouped: inputs, search, chips */
  --border:#e6e8ec;  --border-alpha:#0000000f;
  --text:#23272d;    --text-2:#6b727b;  --text-3:#8b929b;  --text-4:#bfc3ca;
  --brand:#2e5cff;   --brand-subtle:#f4fcff;
  --yes:#007e26;     --yes-strong:#007e26;  --yes-text:#04af52; --yes-tint:rgba(0,156,57,.15);
  --no:#df0c10;      --no-tint:rgba(223,12,16,.09);  --no-text:#df0c10;
  --hover-overlay:#0000000d;  --overlay:#00000066;
}
[data-theme=dark]{
  --bg:#0c0e13;  --surface:#1c1f27;  --surface-2:#1c1f27;  --surface-3:#2d3037; /* grouped-elevated */
  --border:#2d3037;  --border-alpha:#ffffff1f;
  --text:#ffffff;  --text-strong:#edeff1;  --text-2:#b6bbc4;  --text-3:#999ea7;  --text-4:#62646a;
  --brand:#3262ff;  --chip-bg:#ebf2ff26; /* alpha-200 */  --kbd-bg:#e1f1f613;
  --yes:#007723;          /* solid selected Yes / bid bars */
  --yes-text:#53e67f;     /* Yes label on tinted buttons */
  --yes-accent:#00ae4b;   /* +% deltas, bid prices, "Yes" word */
  --yes-tint:#00942f26;   /* green-500 @15% */
  --no:#df0b10;           /* solid selected No / ask prices */
  --no-text:#ff7767;  --no-tint:#480000; --no-tint-hover:#5d0101;
  --hover-overlay:#ffffff1a; --overlay:#00000099;
}
```
- **Chart line colors:**
  - single series: `#0093fd`, stroke 2.75px;
  - multi-series palette, in order: `#0093fd` (blue), `#ff5952` (red; the 2nd series in a 2-way race), `#ff7f0e` (orange), `#fdc503` (yellow), `#9b51e0` (purple);
  - gridlines: `#62646a`, 1px, dash `1 3`.
- **Positive delta** `#00ae4b` (dark) with a ▲ glyph. **Negative delta** `#df0b10` with a ▼ glyph.

### 1.4 Radii
`--radius:11.2px` (0.7rem). Derived values: sm `7.2px` (card buttons, icons, pills), md `9.2px` (trade buttons, chips, inputs), lg `11.2px`, xl `15.2px` (cards, trade panel, comment box).
Other radii in use:
- nav search: `12px`
- header buttons: `10px`
- hero carousel: `18px`
- bottom sheet: `24px 24px 0 0`
- pills like "Go to…", "Show more markets", "Explore all", the bookmark icon button and the "Past" dropdown: `9999px`

### 1.5 Shadows (dark values; light uses the same structure with opacity .06)
```css
--shadow-card: 0 0 0 1px #ffffff1f, 0 2px 6px -.5px #0000001a, 0 2px 10px 0 #0000001a;          /* minimal-soft (cards at rest) */
--shadow-card-hover: 0 0 0 1px rgb(255 255 255/.10), 0 1px 1px -.5px rgb(0 0 0/.12), 0 3px 3px -1.5px rgb(0 0 0/.12), 0 6px 6px -3px rgb(0 0 0/.12); /* middle */
--shadow-panel: 0 0 0 1px rgb(255 255 255/.10), 0 1px 1px -.5px rgb(0 0 0/.12), 0 3px 3px -1.5px rgb(0 0 0/.12);  /* trade panel */
--shadow-dialog: 0 4px 40px #0006, 0 4px 24px #0006, 0 2px 12px #0006, 0 0 0 1px #ffffff1f;
```
In light theme, the card ring is `0 0 0 1px #0000000f` and the blurs are `#00000006`/`#0000000a`.

### 1.6 Layout constants
- `--page-max-width:1350px`. Content is centered with `padding: 0 24px`, so at 1440 content runs from x=69 to x=1371 (1302px wide).
- `--navbar-height:104px` (logo row 68 + tabs 48 = 116 measured), `--navbar-collapsed-height:64px`, `--mobile-bottom-nav-height:60px`.
- Breakpoints (Tailwind): `md 768`, `lg 1024`, `xl 1280`.

### 1.7 Motion
- **Buttons:** `transition: color, background-color, border-color, scale 120ms ease-out`, plus `:active{transform:scale(.98)}`.
- **Market card:** `transition` (150ms default); on hover, `translateY(-1px)` and the shadow swaps to card-hover.
- **Card Yes/No buttons:** `150ms`.
- **Top progress bar:** 2px, brand blue, glow `0 0 10px brand`.
- **Easing (inf):** spring-ish `linear(0,.062,.199,.362,.521,.659,.771,.856,.918,.96,.987,1.003,1.011,1.014,1.015,1.013,1.011,1.008,1.006,1.004,1.003,1.002,1.001,1,1)`, used for sheets and popovers.

---

## 2. Top header (sticky, `position:sticky; top:0; z-index:30; background:var(--bg)`)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐ 68px
│ [◇ Polymarket]  [🔍 Search polymarkets...                       /]   [Log In][Sign Up](?)(≡) │
├──────────────────────────────────────────────────────────────────────────────────────┤ 48px
│ ↗Trending  Combos  Perps  Breaking  New  Midterms │ Politics Sports Crypto Esports … ›  │
└──────────────────────────────────────────────────────────────────────────────────────┘ 1px border-bottom #2d3037
```
- **Row 1:** `padding:12px 24px 8px`, gap 16px, max-width 1350, centered.
  - **Logo:** 150x24 SVG (mark 19x23 plus wordmark), white. Use your own.
  - **Search:** a `<label>` 600x40 with bg `--surface-2` (#1c1f27), radius 12px, padding `0 10px`, gap 2px, and a 1px transparent border that turns `--border` on focus.
    - Search icon: 20px, color `#edeff1`.
    - Input: 14px/500. Placeholder is "Search polymarkets..." in `#edeff1` at ~30% opacity.
    - Right side: kbd `/` in a 16x20 box, bg `#e1f1f613`, radius 4px, padding `2px 4px`, Geist Mono 13/600 `#7d8189`.
    - The search box flexes to fill the space; it is 600px at 1440.
  - **Right cluster:**
    - **Log in:** h32, padding `0 6px` (≈`0 12px` visually with the label), radius 10px, `1px solid #2d3037`, transparent bg, 14px/600 `#edeff1`, hover bg `--hover-overlay`.
    - **Sign up:** h32, radius 10px, bg `#3262ff`, white 14/600, hover = 5% darker (light) or 10% lighter-mix (dark).
    - **Icon buttons** (help `?`, hamburger `≡`): 32x32, radius 10px, 20px icon `#edeff1`, hover bg `--hover-overlay`.
    - "How it works" (14/600 ghost) shows ≥1280.
- **Row 2, category bar:** h48, `padding:0 24px`, horizontally scrollable (`overflow-x:auto`, scrollbar hidden), with a `›` scroll button pinned right.
  - **Tab item:** inline-flex, gap 6px, padding `4px 10px`, 14/20.
    - Inactive: weight 400, `#b6bbc4`.
    - Active and hover: `#edeff1`. Active is weight 600 and has a 2px white underline flush with the bottom of the bar, spanning the item's text width.
  - The first 3 items have 16px leading icons: trending-arrow, combos, perps.
  - "Midterms" uses a red→purple gradient text (optional; render brand blue).
  - A 1px x 16px vertical divider (`#2d3037`) separates the feature tabs from the topic tabs.
  - Labels, in order: Trending, Breaking, New, | Politics, Sports, Crypto, Finance, Geopolitics, Tech, Culture, Economy, Weather, Elections, Mentions.
- **On scroll:** the nav stays sticky at 116px. On event pages, a compact event header (40px icon, 14–16px title, action icons) becomes sticky directly under it at `top:116px` with bg `--bg` and padding `4px 0`.

---

## 3. Homepage

```
┌ header ───────────────────────────────────────────────────────────────┐
│ ┌──────── Featured carousel 907x480 ─────────┐ ┌─ Breaking News › ──┐ │
│ │ [icon] Title 24/600              [🔗][🔖]  │ │ 1 Will X…    100%  │ │
│ │ outcome list (left)  │ multi-line chart    │ │               ↗86% │ │
│ │ ● name   42%         │  legend on top      │ │ 2 …                │ │
│ │ comments ticker      │                     │ ├─ Hot topics › ─────┤ │
│ │ $84M Vol       Ends Oct 27, 2026  ◇logo    │ │ 1 Iran $3M today 🔥›│ │
│ └────────────────────────────────────────────┘ │ [  Explore all   ] │ │
│ ━ • • • • • • (dots)        [‹ Prev] [Next ›]  └────────────────────┘ │
│ All markets                                   (🔍)(⚙ filter)(🔖)     │
│ [All] Midterms  NBA  Fed  Iran …  (chips, h-scroll)                   │
│ ┌card┐ ┌card┐ ┌card┐ ┌card┐   4 cols @≥1280, gap 12                  │
│ … 24 cards …                                                           │
│                 ( Show more markets )                                 │
│ footer                                                                 │
└───────────────────────────────────────────────────────────────────────┘
```
### 3.1 Featured carousel (≥1024)
- **Layout:** two columns. The left is 907px; the right sidebar is ~363px wide, starting at x≈1008 (gap ≈32px).
- **Slide card:** 907x480, bg `#1c1f27`, `1px solid #2d3037`, radius 18px, padding `20px 20px 16px`.
  - Header: 40px flag/icon at radius 8px, title 24/32/600, link and bookmark icon buttons on the right.
  - Body grid: outcome list ~360px on the left, chart on the right.
  - Outcome rows: 28px avatar, name 14/500, % at 18/600 on the right.
  - Chart legend: colored dot + name + % at 12px.
  - Footer: `$84M Vol` 13/500 `#b6bbc4`; "Ends Oct 27, 2026" plus faint watermark on the right.
- **Pager:** below the card. Dots are 6px circles in `#45474e`; the active dot is a 24x6 pill in white. Prev/Next pills (h32, radius 9999, bg `#1c1f27`, 13/600 `#b6bbc4`) are labeled with the next event's short name.
- **Breaking News list:** numbered 1–3. Rank is 13 `#b6bbc4`. Title is 14/20/500, white, 2-line clamp. Right column: % at 18/600 and a delta below it (13/500, `#00ae4b` ↗ or `#df0b10` ↘).
- **Hot topics:** numbered 1–5. Name is 14/500. "$3M today" is 13/500 `#b6bbc4`, followed by a 🔥 icon and a chevron.
- **"Explore all":** full-width h40 pill, radius 9999, `1px solid #2d3037`, 14/600.

### 3.2 "All markets" header and chips
- **Title:** H2 20/24/600. Right side: three 32px icon buttons (search, filters, bookmarks).
- **Chips row:** h32. Chip padding `0 12px`, radius 12px, 14–16px/500.
  - Inactive: `#d2d4d9` text, no bg.
  - Active ("All"): bg `#2d3037`, text `#edeff1`.
  - Horizontal scroll with no scrollbar.

### 3.3 Market card grid
- `display:grid; gap:12px; grid-template-columns: 1fr` → `md:repeat(2,1fr)` → `lg:repeat(3,1fr)` → `xl:repeat(4,1fr)`. At 1440 each card is 316.5px wide.
- **Card base:** `min-height:180px; height:100%`, bg `--surface` (#1c1f27), radius 15.2px, `box-shadow:var(--shadow-card)`, `padding-top:12px`, `display:flex; flex-direction:column; justify-content:space-between; overflow:hidden`.
  - Hover: `translateY(-1px)` and `--shadow-card-hover`.
  - The whole card is a link (stretched `::after`). Inner buttons sit at `z-index:30`.

#### 3.3.1 Binary card anatomy (single Yes/No market)
```
┌──────────────────────────────────────┐ padding 0 12px
│ [38px img] Title 14/20/590 (3-line)  ╭──╮  │  gauge 58x34
│            clamp, flex:1         19%  │
│                               chance  │
│ ┌─────── Yes ──────┐ ┌────── No ─────┐│  h40 each, gap 8
│ └──────────────────┘ └───────────────┘│
│ $339K Vol.                        (🔖)│  13/16/490 #b6bbc4 ; 28px round btn
└──────────────────────────────────────┘ padding 0 12px 8px, gap 6
```
- **Header row:** gap 8px.
  - Icon: 38x38, radius 7.2px, `object-fit:cover`.
  - Title: H3 14/20/590, `-webkit-line-clamp:3` (max height 60).
  - A 16px gap, then the gauge block (70px wide).
- **Gauge:** SVG 58x34, a semicircle arc of radius 29 with `stroke-width:4.5` and `stroke-linecap:round`.
  - Track: `#45474e` (dark) / `#e6e8ec` (light).
  - Fill: drawn from the left end, proportional to p.
  - Fill color by value: red `#df0b10` when p<50 (opacity ≈ .7–.85), green `#009431` when p≥50 (inf), gray around 50.
  - Centered under the arc: "19%" at 16/20/500 white, then "chance" at 12/16/600 `#b6bbc4`.
- **Yes button:** `flex:1; height:40px; border-radius:7.2px; padding:8px`, 14/20/600.
  - Rest: bg `#00942f26`, text `#53e67f` (dark). Light theme: bg `rgba(0,156,57,.15)`, text `#007e26`.
  - Hover: bg `#007723` (dark) / `#007e26` (light), text `#fff`.
- **No button:** same size.
  - Rest: bg `#480000`, text `#ff7767` (dark). Light theme: bg `rgba(223,12,16,.09)`, text `#df0c10`.
  - Hover: bg `#df0b10`, text `#fff`.
- **Footer:** h28, `$339K Vol.` 13/490 `#b6bbc4`. Optional "· NFL · 4:25 PM" or a "LIVE" red dot. Bookmark is a 28x28 round ghost button with a 16px icon.

#### 3.3.2 Multi-outcome card anatomy
```
┌──────────────────────────────────────┐
│ [38px] Which party will win the      │  title 2-line
│        Senate in 2026?               │
│ Democratic Party        72% [Yes][No]│  row h40, gap 16
│ Republican Party        29% [Yes][No]│
│ $14M Vol.                         (🔖)│
└──────────────────────────────────────┘
```
- **Outcome rows:** show the top 2 (rows area h80, scrollable if more). Each row is `display:flex; align-items:center; gap:16px; height:40px`.
  - Name: 14/20/440, white, ellipsis.
  - %: 15/22.5/600, right-aligned.
  - Mini Yes/No buttons: each 40x27 (min), radius 5.2px, padding `0 14px`, 14/600, same colors as the binary buttons. On hover, the label swaps from "Yes"/"No" to the price ("72%").
- **Sports variant:** two team rows (20px team logo + name 14/500 + % right). Below them, two full-width h40 buttons tinted with team colors (e.g. Chiefs red tint, Broncos orange tint), then the footer `$5M Vol. · NFL · 4:25 PM`.

### 3.4 Show more and footer
- **"Show more markets":** centered h40 pill, radius 9999, `1px solid #2d3037`, padding `0 16px`, 14/600. It appends 24 cards per page.
- **Footer:** bg `--bg`, top border `#2d3037`, ~664px tall, max-width 1350.
  1. Tagline "The World's Largest Prediction Market™" (14/600).
  2. "Markets by category and topics": a grid of topic links. Each has a title (14/500) and a "Predictions & odds" subline in 13 `#b6bbc4`, plus "View more".
  3. Two link columns: "Support & Social" and "Polymarket" (Rewards, APIs, Leaderboard, Accuracy, Brand, Activity, Careers, Press). Links are 14/20 `#b6bbc4`; hover makes them white.
  4. Bottom bar: © line · Privacy · Terms · … at 13px `#7d8189`, a language select, and a 12px legal paragraph.

---

## 4. Event page

### 4.1 Layout
```
┌ header (116) ────────────────────────────────────────────────────────────────┐
│ ┌──── main column 922px ──────────────────────────┐  ┌─ sticky aside 372 ─┐ │
│ │ [64 icon] World · Reza Pahlavi           [</>][🔗][🔖]│  │ ┌ trade panel 340 ┐│ │
│ │           Will the Iranian regime fall…? (24/600)│  │ │ …               ││ │
│ │ (Past ▾) (Dec 31) (Jun 30, 2027) (Dec 31, 2027)  │  │ └─────────────────┘│ │
│ │ 5% chance ▼10%                       ◇watermark  │  │ By trading, you … │ │
│ │ ┌──────────── chart 922x272 ───────────────────┐ │  │ [promo card]      │ │
│ │ └──────────────────────────────────────────────┘ │  │ (All)(Iran)(Geo…) │ │
│ │ $28,915,563 Vol. · ⏱ Dec 31, 2026   1H 6H 1D 1W 1M ALL ⤨ ⚙│  related markets  │ │
│ │ ┌ Order Book ⓘ ─────────────────────────── ⌄ ┐  │  └───────────────────┘ │
│ │ Rules  Market Context                            │                        │
│ │ rules text… Show more / Market Opened / Resolver │                        │
│ │ Comments (3,729)  Top Holders  Positions  Activity│                        │
│ └──────────────────────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Two columns** at ≥1024. Main is `flex:1` (922px at 1440). The aside is 372px wide with `padding:32px 16px 16px` and `position:sticky; top:116px`. The column gap is about 16px plus the aside padding.
- **Below 1024:** the aside is hidden. A fixed bottom bar shows two buttons ("Yes 5¢" green / "No 96¢" red, h48, the 3-D trading-button style) above the 60px mobile nav. Tapping one opens the trade **bottom sheet** (§6).

### 4.2 Header
- **Icon:** 64x64, radius 8–12px.
- **Breadcrumb:** `World · Reza Pahlavi` links, 14/20/540, `#b6bbc4`, separated by `·`.
- **Title:** H1 24/28/600, white.
- **Actions** on the right: 32px ghost icon buttons (embed `</>`, link, bookmark), 20px icons in `#b6bbc4`; hover bg `--hover-overlay`.
- **Date tabs** (series events): h32 pills, gap 8.
  - "Past ▾" dropdown: bg `#1c1f27`, padding `0 12px`.
  - Active date: bg `#edeff1` / text `#0c0e13`.
  - Inactive date: bg `#1c1f27` / white.
- **Binary headline:** "5% chance" at 24/32/600 in `--brand` (#3262ff). Next to it, the delta "▼ 10%" at 12/600 red, or green ▲.
- **Multi-outcome events** have no headline; the chart shows a legend in its top-left instead.
- **Meta row** below the chart:
  - Left: `🏆 $2,060,553 Vol.` 13/500 white; `⏱ Nov 3, 2026` 13 `#b6bbc4`.
  - Right: range buttons.

### 4.3 Chart
- **Size:** SVG 922 wide. 272px tall for binary, 240px for multi.
- **Y-axis** on the right: labels 0%…60% (auto max; for multi, 0–100% in steps of 25). Arial 12px `#b6bbc4`.
- **X-axis:** month labels at the bottom.
- **Gridlines:** horizontal, 1px `#62646a`, `stroke-dasharray:1 3`.
- **Line:** 2.75px, `#0093fd` for a single series, palette (§1.3) for multi. Stepped/straight segments, no area fill.
- **Last point:** a 4px dot plus a pulsing 8px halo at 30% opacity.
- **Multi-series end labels:** at the line ends on the right, name 13/500 plus % at 26/600, colored to match the series.
- **Hover:** vertical crosshair; tooltip with date and per-series % values.
- **Overlays:** "Source: Polymarket.com" pill bottom-left (bg `#1c1f27`, 11px), and a faint wordmark top-right.
- **Range tabs** `1H 6H 1D 1W 1M ALL`: 14/20/600, padding `4px 6px`, radius 9.2px. Inactive is `#b6bbc4`; active is white (no bg). They are followed by two 20px icon buttons (compare ⤨, settings ⚙).

### 4.4 Outcome table (multi-outcome events)
```
│ [40 img] Adam Hamilton (D)          53% ▲1%     [ Buy Yes 53¢ ][ Buy No 48¢ ] │ row 72px
│          $999,877 Vol. 🎁                                                      │
├──────────────────────────────────────────────────────────────────────────────┤ 1px #2d3037
```
- **Row:** h72 (`padding:12px 0`), `border-top:1px solid #2d3037`, cursor pointer. Hover: a bg `#1c1f27` rounded 12px that bleeds 8px horizontally.
- **Left block:** 40x40 avatar (radius 8), name 16/20/600, then `$999,877 Vol.` at 13/490 `#b6bbc4` with a 🎁 rewards icon.
- **Center:** % at 28/28/600, centered in a ~120px column, then the delta 12/600 (▲ `#009431` / ▼ red).
- **Right:** two 136x48 buttons, gap 8, radius 7.2px, padding `8px 16px`, 14/20/600, label "Buy Yes **53¢**".
  - Selected row: Buy Yes is solid `#007723` with white text.
  - Other rows: Buy Yes is tinted `#00942f26` with text `#53e67f`.
  - Buy No: `#480000` bg with text `#ff7767`. When "No" is the selected side it becomes solid `#df0b10` with white text.
- **Clicking a row** expands it inline into a panel with sub-tabs: **Order Book · Graph · Resolution** (14/16/600; inactive `#b6bbc4`). Action chips on the right: "Maker Rebate" (yellow icon) and "+ Rewards" (brand), plus a refresh icon. Clicking also sets the trade panel to that outcome.
- **Binary event:** the outcome table is replaced by a single collapsible "Order Book ⓘ" card.
  - Collapsed: h72, bg `#1c1f27`, radius 15.2px, padding 16px, H3 16/600, chevron right.
  - Date-series events instead show one row per date: name, then "19%", then the Buy Yes/No buttons, plus a "View resolved ⌄" link.

### 4.5 Order book (expanded)
```
 Trade Yes  Trade No                                   + Rewards  ⟳
 TRADE YES ⇅             PRICE          SHARES           TOTAL
 ▒▒▒▒▒▒                   9¢          18,556.36       $26,117.42    ← asks: red, highest on top
 ▒▒▒▒                     6¢         172,950.15       $18,046.02
 [Asks]▒▒                 5¢         153,380.14        $7,669.01    ← best ask, red "Asks" tag
 Last: 5¢               Spread: 1¢                                   ← spread row
 [Bids]▒▒▒▒               4¢          …                 …            ← best bid, green tag
 ▒▒▒▒▒▒▒                  3¢
```
- **Container:** inside the card, scroll area max-height 360px (`overflow-y:auto`). It opens scrolled so the spread row is centered.
- **Tabs:** "Trade Yes" / "Trade No", 14/20/600, active white / inactive `#b6bbc4`. They also flip the panel's side.
- **Header row:** h35, 10/15/600 uppercase `#b6bbc4`. Columns: label (~0–30%), PRICE (center ~50%), SHARES (~68%), TOTAL (right).
- **Data row:** h36, full-width button.
  - Price: 14/20/600; asks `#df0b10`, bids `#00ae4b`.
  - Shares and total: 13/17/400 white, tabular-nums.
  - Depth bar: absolutely positioned at the left, height 36, width ∝ cumulative size (max ~30% of row). bg `#df0b10` (asks) or `#007723` (bids) at **opacity .15**.
  - Hover: row bg `--hover-overlay`.
- **Asks/Bids tags:** on the best rows, 20px tall, radius 7.2px, padding `0 6px`, 10/500 white, bg solid red / `#007723`.
- **Spread row:** h36, bg `#f5ffff1a`, 1px top and bottom border `#2d3037`. "Last: 5¢" on the left and "Spread: 1¢" centered, both 12/16/600 `#b6bbc4`.

### 4.6 Trade panel (aside)
```
┌───────────────────────────── 340 ─┐ bg #1c1f27, radius 15.2, padding 16, gap 20, shadow-panel
│ [48 img] Will the Iranian regime…  │ 14/20/500 #b6bbc4 (ellipsis)
│          Yes                       │ 16/24/600, "Yes" #00ae4b / "No" #df0b10
│ Buy  Sell                Market ▾  │ tabs 16/20/600; underline 2px white; border-bottom 1px #2d3037
│ ┌── Yes 5¢ ──┐ ┌── No 96¢ ──┐      │ 148x48 each, gap 12
│ Amount                       $20   │ 16/500 label ; input 40/60/600 right-aligned
│                [+$1][+$5][+$10][+$100] │ chips h30
│ To win 💵                  $20.83  │ 16/500 ; value 40/60/600 #009431
│ Avg. Price 96¢ ⓘ                   │ 12/18/500 #b6bbc4
│ [══════════ Trade ══════════]      │ h43 + 5px ledge, brand blue
└────────────────────────────────────┘
  By trading, you agree to the Terms of Use.   (12px #b6bbc4, centered, link underlined)
```
- **Header:** 48x48 market image (radius 7). Market title 14/20/500 `#b6bbc4`; outcome line 16/24/600 (for multi: "Adam Hamilton (D) · **Yes**").
- **Buy/Sell tabs:** gap 12, 16/20/600, active white with a 2px white underline at the bottom of the row, inactive `#b6bbc4`. Row padding `0 16px 8px` with a 1px bottom border `#2d3037` spanning the panel's full width (negative side margins).
- **Order-type dropdown:** "Market ▾", 14/20/500, white, 12px chevron `#62646a`. Options: Market / Limit.
  - Limit mode (inf, from prior knowledge): replaces Amount with **Limit Price** (a stepper with −/+ buttons, value in ¢) and **Shares** (input plus quick chips), and adds a "Set expiration" toggle.
- **Outcome buttons:** `.trading-button`, 48px tall, radius 9.2px, label "Yes **5¢**" with label 15/600 and price 16/600.
  - Selected Yes: bg `#007723` (dark) / `#007e26` (light), white text.
  - Selected No: bg `#df0b10`, white text.
  - Unselected: bg `#1c1f27` plus `inset 0 0 0 1px #2d3037`, with the text at **50% opacity**.
- **Amount:**
  - Label "Amount" 16/20/500.
  - Input: transparent bg, 40/60/600, right-aligned, `$` prefix rendered inside. Placeholder "$0" in `#62646a` (dark gray when empty).
  - Chips: h30, padding `0 10px`, radius 9.2px, bg `#ebf2ff26`, 12/16/600 `#b6bbc4`, gap 4. They add the amount; hover bg is brighter.
  - Sell mode: chips become 25% / 50% / Max (inf).
- **Summary:** appears when amount > 0, separated by a 1px top border `#2d3037` and padding-top 16.
  - Left: "To win 💵" at 16/500, with "Avg. Price 96¢ ⓘ" underneath at 12/500 `#b6bbc4`.
  - Right: the payout at 40/60/600 `#009431`. Payout = amount / price.
- **Trade button (3-D "ledge" button):**
  - `height:43px; border-radius:9.2px; background:#3262ff; box-shadow:0 5px 0 0 rgba(0,0,0,.2), 0 5px 0 0 #3262ff`.
  - Label "Trade" 14/600 white, nudged down 1.25px.
  - Hover: `translateY(1.5px)`, ledge reduced to 3.5px, opacity .8.
  - Press: `translateY(3px)`, ledge 2px.
  - Transitions: `transform .12s cubic-bezier(.4,0,.2,1), box-shadow .12s`.
  - The same ledge system applies to the green/red outcome buttons, with ledge shade `#0003`.
  - Logged-out state: the label reads "Log in to trade" (inf); on the live site it stays "Trade" and opens the auth modal.
- **Below the panel:**
  - Terms line.
  - A promo card (radius 15.2, brand bg). Optional: skip it.
  - Related-markets filter chips: h32, padding `0 12px`, radius 11.2px, 13/16/600; active bg `#1c1f27` white, inactive `#b6bbc4`.
  - Related list rows: 40px image, title 14/500 2-line, % at 18/600 right.

### 4.7 Rules / Market Context
- **Tabs:** "Rules" and "Market Context", 16/20/600, gap 16. Active white, inactive `#b6bbc4`, no underline.
- **Rules body:** 14/20/400 white, `white-space:pre-line`, clamped to ~5 lines with an inline "Show more" (14/500 `#b6bbc4`).
- **"Market Opened:"** in 14/600, followed by the date at 14/400.
- **Resolver card:** h64, bg `#1c1f27`, radius 15.2, `--shadow-card`, padding `12px 24px 12px 8px`, gap 16. Contents: a 48px logo tile, the "Resolver" label 14 `#b6bbc4`, and an address link 14 `#3262ff` truncated `0x65070be91...`.
- **"Propose resolution":** h32 pill, radius 9999, `1px solid #2d3037`, 14/600, auto width.
- **Market Context tab:** an AI summary paragraph with a "Generated…" footnote (inf).

### 4.8 Comments / Top Holders / Positions / Activity
- **Tab row:** gap 16, 16/20/600; active white, inactive `#b6bbc4`. "Comments (3,729)" includes the count.
- **Composer:** form h50, `1px solid #2d3037`, radius 15.2. Textarea 14/20 with padding `14px 112px 14px 14px` and placeholder "Add a comment...". On the right: emoji and gif 20px icons, then the **Post** button (h32, padding `0 14px`, radius 9.2, bg `#3262ff`, 14/600; dimmed until there is text).
- **Controls row:** "Newest ▾" sort (14/500), a "Holders" checkbox (16px box radius 4), and on the right a "🛡 Beware of external links." pill (13/600 `#b6bbc4`, bg `#1c1f27`, radius 9999, h28).
- **Comment item:**
  - 40px round avatar.
  - Author: 14/600 white.
  - Position badge: "5.1K Yes" 12/16/600, `#007723` on bg `#00792226` (red variant for No), radius 7.2, h22, padding `0 6px`.
  - Time: `<time>` "3d ago" 13/500 `#b6bbc4`.
  - "⋯" menu on the right.
  - Body: 14/20 white.
  - Like button: heart 16px + count 14/600, h24, radius 7.2, padding `4px 6px 4px 4px`.
  - "2 Replies ⌃" toggle: 12/16/600 `#b6bbc4`, radius 7.2, padding `2px 8px`.
  - Replies are indented 56px and use a 32px avatar.
- **Top Holders:** two columns, "Yes holders" and "No holders". Rows have a 32px avatar, name 14/600, and shares 13 `#b6bbc4` on the right. Column header 12/600 uppercase `#b6bbc4` (inf: layout from prior knowledge).
- **Activity:** a feed of trades: avatar, "**name** bought **120 Yes** at 5¢ ($6.00)", with the time on the right at 13 `#b6bbc4` (inf).

---

## 5. Leaderboard and portfolio

### 5.1 Leaderboard (`/leaderboard`)
```
┌ main 874 ──────────────────────────────────────────┐ ┌ aside 380 (radius 16, ring) ┐
│ Leaderboard ⓘ                    (H1 32/36/600)    │ │ Biggest wins this month     │
│ Predictions  Perps  Combos       (tabs, h40)       │ │ 1 (av) name   Event title…  │
│ [Today|Weekly|Monthly|All]            [All Categories ▾] │ │   $1,240,216 → $3,273,511 │
│ 🔍 Search by name                Profit/Loss │ Volume │ │ 2 …                         │
│ 1  (40 av+medal) BreakTheBank      +$6,987,188  95,538,717 │ │ … (scrollable, 600 tall)│
│ ─────────────────────────────────────────────────── │ └─────────────────────────────┘
```
- **Columns:** main ~874px plus a 380px aside, gap ~48px.
- **Tabs:** "Predictions / Perps / Combos", h40, padding `0 8px`, 16px; active `#edeff1`, inactive `#7d8189`. A 1px bottom border `#2d3037` runs under the row, with a white 2px underline on the active tab.
- **Period segmented control:**
  - Wrapper: `1px solid #2d3037`, radius 9.2.
  - Segments: h36, padding `8px 16px`, radius 7.2, 14/600.
  - Active segment: bg `#2e303880`, white text. Inactive: `#b6bbc4`.
  - Segments: Today, Weekly, Monthly, All.
- **"All Categories ▾":** h40 button, padding `0 16px`, radius 9.2, `1px solid #2d3037`, 14/600.
- **Search:** h40, radius 9.2, padding-left 28 (icon at left 12), placeholder "Search by name", 14px, ring `0 0 0 1px #2d3037`.
- **Column headers:** "Profit/Loss" (active sort, white, with a 2px underline) and "Volume" (`#b6bbc4`), 14/500, right-aligned, with a 1px divider between them.
- **Rows:** ~88px tall (40px content plus `padding:24px 0`), `border-bottom:1px solid #2d3037`, gap 16.
  - Rank: 14/500 `#b6bbc4`, in a 32px column.
  - Avatar: 40px circle (gradient fallback). Top 3 get a 16px medal badge overlapping bottom-left (gold/silver/bronze).
  - Name: 16/20/500 white, ellipsis. An optional 𝕏 badge follows.
  - P/L: 14/500 white, `+$6,987,188`, right column ~100px.
  - Volume: 13/500 `#b6bbc4`, right column 100px.
- **Aside card:** bg `--bg`, radius 16, ring shadow, padding 20, max-height 600 with scroll.
  - Title: 20/24/600.
  - Rows: rank, 32px avatar, name 14/600, event title 14 `#b6bbc4` (ellipsis), and "$1,240,216 → **$3,273,511**" (13/490 white → 13/500 `#00ae4b`). 1px dividers.

### 5.2 Portfolio (`/portfolio` needs login; mirror the `/@username` profile layout)
```
┌ wrap 1000px (centered) ─────────────────────────────────────────────────┐
│ Predictions  Perps                                                       │
│ ┌ Profile/Value card 476x281 ─────┐ ┌ P/L card 476x281 ────────────────┐ │
│ │ (56 av) Name 24/600   [⧉][⇪]    │ │ ▲ Profit/Loss    1D 1W 1M 1Y YTD ALL│
│ │ Joined Jan 2026 · 254.7K views  │ │ $777,855.31 (30/36/600) ⇪  ◇wm   │ │
│ │ ─────────────────────────────── │ │ Past Day (12 #b6bbc4)            │ │
│ │ $5.1M      $1.4M     1,327      │ │ area chart (stroke brand→purple  │ │
│ │ Positions  Biggest   Markets    │ │ gradient, fill fades to 0)       │ │
│ │ Total PnL            +$11.4M    │ │                                  │ │
│ │ Total Volume          375.3M    │ │                                  │ │
│ └─────────────────────────────────┘ └──────────────────────────────────┘ │
│ Positions  Activity                                                      │
│ [Active|Closed] [🔍 Search positions                       ] [⇅ Value ▾] │
│ MARKET                                      AVG   CURRENT↕   VALUE↕      │
│ [40] Chiefs vs. Broncos                    50.7¢   89.5¢   $824,732.70 ⇪ │
│      [Chiefs 50.7¢] 921,489.1 shares                $357,501.92 (76.52%) │
└──────────────────────────────────────────────────────────────────────────┘
```
- **Wrapper:** 1000px wide, centered.
- **Two cards:** each 476x281, gap 16. bg `#1c1f27`, `1px solid #2d3037`, radius 15.2, padding 16.
- **Profile/value card:**
  - Stats row: 3 centered columns, value 18/28/500, label 12/16/500 `#b6bbc4`, separated from the header by a 1px top border.
  - Key/value lines (Total PnL in `#00ae4b`, Total Volume): 12px.
  - For your own portfolio use: **Portfolio value**, **Cash**, and a **Deposit** (brand) / **Withdraw** (outline) pair.
- **P/L card:**
  - Header: "▲ Profit/Loss" 14/500 `#b6bbc4`.
  - Value: 30/36/600.
  - Range chips: h28, padding `0 8px`, radius 9.2, 12/600. Active chip text `#3262ff` on bg `#3262ff1f`; inactive `#b6bbc4`.
  - Chart: area chart, stroke a gradient from `#3262ff` → `#9b51e0`, fill fading to transparent.
- **Section tabs:** "Positions / Activity", 16/20/600. In your own portfolio: Positions · Open orders · History.
- **Toolbar:**
  - Active/Closed segmented control: h32, radius 10. Active segment bg `#2d3037`.
  - Search input: h40, bg `#1c1f27`, radius 12, placeholder "Search positions".
  - Sort dropdown: "⇅ Value ▾", h40, `1px solid #2d3037`, radius 9.2.
- **Table header:** 11/15/500 uppercase `#b6bbc4`. Columns: MARKET (flex), AVG (80, right), CURRENT ↕ (80, right), VALUE ↕ (160, right), action (40).
- **Position row:** h~69, padding `12px 16px`, 1px divider; hover bg `#1c1f27`.
  - 40px image (radius 8).
  - Title: 13/21/500.
  - Outcome pill: "Chiefs 50.7¢" 12/16/600, padding `2px 6px`, radius 7.2. Yes or winning outcome: bg `#004108`, text `#53e67f`. No: bg `#480000`, text `#ff7767`.
  - "921,489.1 shares": 12/18/500 `#7d8189`.
  - AVG and CURRENT: 14/20/500.
  - VALUE: 14/21/500 white, with the change underneath at 12/18/500 (`#009431` positive / `#df0b10` negative), formatted "$357,501.92 (76.52%)".
  - Share/sell icon: 32px ghost.
- **Open orders columns (inf):** Market · Side (Buy/Sell pill) · Outcome · Price · Filled / Total · Expiration · ✕ cancel.
- **History columns (inf):** Activity type (Bought / Sold / Redeemed / Deposited) · Market · Outcome pill · Price · Shares · Value · relative time.

---

## 6. Responsive and micro-interactions

| Width | Behavior |
|---|---|
| ≥1280 | Card grid 4 cols. Header shows "How it works". |
| 1024–1279 | Grid 3 cols. Event page keeps the sticky 372px aside. Home carousel plus sidebar. |
| 768–1023 | Grid 2 cols. Event aside is removed; the trade UI becomes a bottom sheet with a fixed bottom Yes/No bar. Home sidebar hidden. |
| <768 | Grid 1 col with 16px side gutter. The search box collapses: search moves to the bottom nav. Header is logo + CTA, and the tab bar scrolls. |

- **Mobile header:** row 1 is the logo (24px) plus the right CTA (h32 pill). The category tabs row is 48px. The geo banner sits on top (40px).
- **Mobile bottom nav:** fixed, h60, bg `--bg`, 1px top border `#2d3037`, 4 equal items: **Home, Search, Breaking, More**. Each item is a 22px icon over a 12/500 label. Active is white; inactive `#b6bbc4`. Add bottom padding `env(safe-area-inset-bottom)`.
- **Mobile featured carousel:** single cards ~340px wide with peeking neighbors, using scroll-snap. Dots go under the cards.
- **Mobile event page:**
  - Header: 48px icon, title 20/600 on 2 lines, share and bookmark icons.
  - Chart is full width (~280px tall).
  - Fixed bar above the bottom nav: two 3-D buttons "Yes 5¢" (`#007723`) and "No 96¢" (`#df0b10`), h48, gap 12, padding 16.
- **Trade bottom sheet** (vaul-style):
  - Overlay `#00000099`. The page behind scales to ~0.95 with radius 12.
  - Sheet: bg `#1c1f27`, radius `24px 24px 0 0`, 1px top border `#2d3037`, padding 24.
  - Contents, top to bottom:
    1. A "Buy" pill (left) and a settings ⚙ icon (right).
    2. Market row (48px image, title, outcome).
    3. A huge centered amount (64px/600, "$0" placeholder in `#62646a`).
    4. Yes/No segmented toggle (active pill bg `#2d3037`).
    5. Chips `+$1 +$5 +$10 +$100`.
    6. A full-width 3-D blue **Trade** button.
  - Drag handle: 36x4 `#45474e` (inf).
- **Hover and active summary:**
  - Cards lift 1px and gain shadow.
  - Card Yes/No tints turn solid with white text.
  - Ghost buttons get an `#ffffff1a` overlay (dark) / `#0000000d` overlay (light).
  - All buttons scale to .98 on `:active`.
  - Order-book rows highlight on hover; clicking a row pre-fills a limit price (inf).
  - Tab text color transitions over 150ms.
- **Focus:** `outline:none; box-shadow:0 0 0 2px var(--bg), 0 0 0 4px #b6bbc4` (ring-2 + offset-2).
- **Loading:** skeleton blocks are `#1c1f27` rounded rectangles with a pulse (opacity 1 → .5, 2s). The trade panel shows a skeleton until market data loads.
- **Numbers:** `font-variant-numeric: tabular-nums` for prices, %, and order-book figures.
- **Formatting rules:**
  - Prices in ¢ (round to whole cents, or 1 decimal under 1¢: `<1%`, `0.4¢`).
  - Probabilities as `NN%`, with `<1%` and `>99%` at the extremes.
  - Volume abbreviated on cards (`$339K Vol.`, `$14M Vol.`) and full on event pages (`$28,915,563 Vol.`).

---

## 7. Open questions
- The Market/Limit dropdown could not be opened in view-only mode, so the Limit layout (§4.6) comes from prior knowledge and is not observed.
- The Log in / Sign up buttons were hidden by the US geo. Their styles were measured from the hidden DOM; their exact on-screen padding is inferred as roughly 12px.
- The light-theme screenshot could not be fully toggled. The light values in §1.2–1.3 come from the `[data-theme=light]` token sheet and were not rendered.
- The portfolio page was not observed logged in. Its open orders and history columns are inferred.
