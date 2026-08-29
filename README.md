# Tracky

A fast daily expense tracker. Log a spend in about three taps, see where the
money went, and stay inside a monthly budget.

It is a Progressive Web App: plain HTML, CSS and JavaScript with no build step
and no framework. Out of the box everything you log stays in your browser's
storage on your own device.

Optionally it syncs to **a Google Sheet you own** (see `server/`), which gets
you three things: the data lives somewhere other than one phone, every device
shows the same expenses, and an iOS Shortcut can log one **without opening the
app at all**.

## Publishing it

One-time setup, in this repo's **Settings → Pages**: set Source to
**Deploy from a branch**, pick branch `main` and folder `/ (root)`, then Save.
GitHub serves the site a minute or so later and republishes it on every push.

(The Actions token is not permitted to create a Pages site programmatically,
so this one switch has to be flipped by hand.)

## Install on your phone

**iPhone** — open the site in Safari, tap Share, then **Add to Home Screen**.
It then launches full-screen with its own icon, exactly like an App Store app.

**Android** — open in Chrome and accept the "Install app" prompt.

Once installed it works with no connection at all.

## What it does

- **Three-tap logging** — a big on-screen keypad, category chips, and an
  optional note. No system keyboard needed for the amount.
- **Editable categories** — rename, re-icon, reorder and add your own in
  Settings. See "Retiring a category" below for why deletion is deliberately
  restricted.
- **Quick add from a Shortcut** — `?amount=250&category=Food&note=Chai&save=1`
  logs the expense on arrival and confirms it by name, so an iOS Shortcut on
  Back Tap, the Lock Screen or Siri can capture all three fields with nothing
  to tap in the app. Drop `&save=1` to land on a prefilled keypad instead.
  Auto-save refuses when anything is ambiguous — a zero amount, or a category
  name it does not recognise — and falls back to the keypad rather than filing
  the expense under a guess. The query string is stripped on arrival, so a
  reload can never write the same expense twice.
- **CSV export** alongside the JSON backup, for spreadsheets.
- **Daily view** with per-day totals and full history; swipe back through
  earlier days with the arrows or jump to a date.
- **Monthly budget** that tells you what is left *and* what that works out to
  per day for the rest of the month, so overspending shows up early.
- **Compare** — an interactive dashboard that zooms out in four steps:
  **Day → Week → Month → Year**, starting on Day. Day zoom offers **two shapes**
  for the same data — the bar chart (the default) for the run of recent days, or
  a **month calendar** with every day shaded by what was spent on it. One tap
  switches, and the choice is remembered. Swipe the chart or tap a bar to pick a
  period; focus a single category to rescope the whole screen. Under
  the chart, **where it went** breaks the period down by category with each
  one's share of the total, and **Entries** lists the actual expenses behind
  every figure — editable in place, exactly like the Today list, and changing
  as soon as you pick a different date. Every plotted value is also available
  as a plain table.
- **Light, dark, or match the phone**, in Settings. Matching is the default and
  follows the phone live, including its sunset schedule; picking Light or Dark
  overrides it permanently, for anyone who finds one of the two easier to read
  regardless of the hour.
- **Eight currencies** with correctly localised formatting.
- **Backup and restore** to a JSON file, plus a full erase.

## Sync

Off by default. `server/README.md` walks through connecting a Google Sheet —
about ten minutes, entirely in the browser.

**Two people, two sheets.** The sync URL and token live in each device's own
settings, and `Code.gs` binds to whichever sheet its script lives in — so two
phones pointed at two deployments keep entirely separate data, with no change to
the app. Nothing needs to be built for "multi-user" unless several people want to
share *one* sheet, which would need real accounts rather than a shared token.

The one way this goes wrong: the first sync **pushes whatever is already on that
phone** up to the configured sheet. Point a phone with a month of history at
somebody else's sheet and the two datasets merge. Take a backup on both phones
before connecting either, and check the URL before syncing.

How it works, briefly:

- Each expense carries a globally unique `uid` and an `updatedAt`. Sync matches
  on the uid, and the newer `updatedAt` wins, on both the phone and the server.
- **Deleting keeps a tombstone** rather than dropping the row. Without one, a
  second device that had not yet heard about the deletion would simply upload
  its copy again and the expense would reappear.
- One request does both directions: a push carries everything changed since the
  last sync, and the reply carries everything this device has not seen.
- The watermark only advances after the incoming batch has been stored, so an
  interruption means re-syncing rather than silently skipping records.
- A failed sync never touches local data — the app keeps working offline and
  catches up later.

Security is a shared token, not real accounts: anyone with both the URL and the
token can read and write. That is proportionate for a personal sheet, but it is
not multi-user auth, so the token should be long and random.

## Retiring a category

Every expense stores a category **id**, and that id is permanent. Renaming a
category therefore changes only its label — all past expenses follow the new
name automatically, and nothing in the history moves.

Deleting is the dangerous direction. If a category with expenses simply
disappeared, those expenses would point at something that no longer exists:
they would drop out of the category breakdown while still counting toward the
total, so the rows would stop adding up to the headline — a quietly wrong
chart. The app closes that path:

- A category **no expense has ever used** can be deleted outright.
- A category **with expenses** cannot. Instead you can **hide** it (it leaves
  the logging picker but keeps every past expense exactly where it is) or
  **merge** it into another category (its expenses are reassigned first, then
  it is removed).

Either way no expense is ever orphaned, and the per-category figures always
reconcile with the total. As a backstop, if a backup from another device
references a category this one has never heard of, that id is still shown in
the breakdown rather than silently dropped.

## Gestures

- **Swipe anywhere to move between tabs** — Stats, Today, Settings — the way a
  photo feed pages between them.
- **Swipe the chart or the calendar** to travel through time: a whole window of
  the chart, a whole month of the calendar. Dragging left moves forward in time,
  the direction the timeline runs.
- **Swipe an expense left** to reveal **Edit** and **Delete** in place — the
  same pattern as Mail, with no intermediate menu to step through.

The swipe actions are **hidden outright** until a row is open or moving, rather
than relying on the row's opaque background to cover them. A photo from a real
phone showed Edit and Delete plainly visible beneath a row sitting at rest — the
layout that produces that is not reproducible here, but nothing to paint over
cannot bleed through. Opening a row also takes a firm pull now (70px, and
decidedly horizontal): the actions it uncovers include Delete, so an accident
there costs more than a stiffer gesture does.

Text selection is off across the app. Resting a finger on a row used to start a
selection, and dragging its handles afterwards *is* a horizontal drag — so the
swipe-to-reveal counted it and merely touching an entry opened its actions.
Native apps do not offer to select their own list labels, so turning it off
removes the collision at the source rather than trying to tell the two gestures
apart. Fields the reader types in, and the Shortcut address, keep selection.

Exactly **two** things own a horizontal drag: the chart/calendar strip and an
expense row. Everything else on a screen belongs to the tab gesture. That rule
cost a feature — the headline cards used to take a drag too, days on Today and
periods on Compare — but with the hero, the chart *and* every row claiming the
gesture there was nowhere left on a screen to start a tab swipe from. Days and
periods still step with the arrows beside their titles, which is the fine
control the swipe was never good at anyway.

Both survivors are things that visibly move under the finger, which is the test:
if a drag claims your gesture, it owes you something moving.

The tab gesture stands down whenever the drag started inside one of those two,
so a row swipe and a chart swipe never also flip the tab.

**A swipe moves a whole window, not one period.** The strip slides a full page,
so a full page of content has to change; moving one day behind a full-page
animation was a mismatch — the screen said "here is a different week" while the
content said "the same week, shifted one". The two windows are contiguous: no
repeated column, no gap.

Direction is decided from the first few pixels of a drag: a mostly-vertical
movement stays with the scroller and is never reclaimed, so a slightly slanted
scroll cannot turn into a page change.

On a trackpad the same gesture is not a drag at all. Two fingers never move the
pointer, so none of that handling runs; the browser reads it as horizontal
scrolling, finds nothing to scroll, and gives it to its own back/forward
navigation — which slides the entire page sideways. The chart therefore also
listens for `wheel` and claims horizontal ones, which stops the page sliding and
scrolls the chart instead. One gesture moves one period however hard it is
thrown: a trackpad keeps sending deltas for about a second after the fingers
lift, and letting distance decide would hand control to that momentum tail.

Both the chart and the calendar sit in a **three-page strip** — the page before,
the page shown, and the page after — with the middle one at rest. A drag moves
the strip itself, one-to-one with the finger, so the neighbour is already drawn
and travelling into view rather than appearing once the gesture has ended. The
card never moves; before this the card was nudged a few pixels and its contents
swapped underneath, which read as the page changing rather than the contents
scrolling. A drag towards a page that does not exist still moves, just
reluctantly, which says "nothing here" by feel rather than by refusing.

A swipe **scrolls the chart**: the whole window slides one period and the
selection keeps its place inside it, so the first swipe already uncovers a day
that was not on screen. It used to move only the selection, leaving the window
put until the selection fell off the edge — which meant six swipes that changed
nothing but a highlight before anything appeared to move. Tapping is the
complementary gesture and still picks a bar without moving the window: **swipe
to travel, tap to choose**.

Scrolling forward stops at the present, since nothing has happened after it. The
forward arrow greys out there rather than staying live and doing nothing.

Three further details are what make the gesture feel like it is working rather
than like nothing happened:

- The card's snap-back transition is **switched off while the finger is down**.
  Left on, it animates *towards* each new position instead of sitting at it, so
  the card trails the finger and the drag feels dead.
- A touch fires `pointerenter` on a bar but **never** `pointerleave`, so the
  tooltip would pin itself open for the whole gesture and stay there afterwards,
  naming a period that is no longer selected.
- A swipe ends in a synthesised click. Without a short guard after the gesture,
  that click selects whichever bar the finger lifted over and immediately undoes
  the period change.

## Editing an expense

Tap any row on the Today screen or in the Compare screen's **Entries** list, or
use **Edit** from its swipe actions. The
sheet reopens prefilled, so you can fix the amount, move it to another category,
change the note, or delete it.

Deleting from a swipe offers **Undo** rather than a confirmation dialog: a swipe
is easy to make by accident, so the recovery belongs after the action rather
than as a question before it. Undo works because deletion is a tombstone — the
restore simply clears the flag, and its fresh timestamp means the un-delete wins
on every other device too.

## Look and feel

The chrome follows Apple's Liquid Glass material: the header and the tab bar are
translucent, blurred panels that content scrolls beneath, the tab bar is a
detached capsule rather than a bar welded to the screen edge, and the add button
is tinted glass with a specular top edge.

Light mode is where glass is hardest to see: a pale fill over a pale page reads
as a solid white slab whatever its alpha claims. So the fill is thin (46%) and
the blur is heavy — **the blur, not the fill, is what stops the text behind from
being legible through the panel**. Dark is thinner still, and lighter than the
page behind it, the way frosted glass catches light.

Thinning the fill puts more of the content behind into the panel, which costs
contrast for the labels on top of it. Secondary text on glass therefore has its
own token, darker than `--muted` on light and lighter on dark, set so the tab
labels stay above 4.5:1 with a white expense row blurred behind them. Measured
off rendered pixels, not judged by eye.

### What makes it read as an iOS app rather than a web app

- **Grouped inset lists, not a card per row.** Expenses are one rounded container
  with hairline rules between rows, inset past the icon. A shadowed card per row
  is a Material idiom: it reads as six objects with gaps of page showing between
  them, where Apple's lists are one object with rules inside. This is the single
  loudest tell, and fixing it changed more than anything else here.
- **No drop shadows.** Surfaces are separated by colour and a hairline.
  Elevation is Google's metaphor; iOS does not use it for content.
- **The navigation bar is nothing until you scroll.** No fill, no rim, no
  shadow — just its buttons. An empty glass strip across the top of a screen
  that has a large title right under it is a bar with no job; it materialises
  only once content is passing beneath it, which is the moment it gets one.
- **True black in dark mode.** `#000`, not a dark grey. On the OLED panel in
  every iPhone since the X those pixels are simply off, which is why Apple's dark
  mode goes there — and why `#0b0b13` reads as a washed-out imitation beside it.
- **A type scale with actual range.** Everything used to sit at 13–17px in the
  same weight, so nothing receded. There is now a large title that collapses into
  the bar as you scroll, a section title, body, and a genuinely quiet footnote.
- **One colour per category**, carried by its icon circle and its share bar so
  the two are obviously about the same thing. Colours are stored as an index into
  a palette rather than a hex value, because the same hue needs to be deeper on
  white and brighter on black; the stylesheet holds both and the category holds
  the number. Every bar clears 3:1 against its card in both themes.
- **A real segmented control** — a sunken track with one raised thumb — instead
  of a row of tinted toggle buttons.
- **The tab bar marks its selection by colour alone**, not with a filled pill.

The one deliberate deviation is the **add button**: iOS has no floating action
button, and Apple would put a `+` in the top-right of the navigation bar. It is
centred and oversized here because that is the easiest place on a phone to hit
without looking, which matters more for this app's reader than the convention
does. The cost is that it floats over the list while scrolling.

Apple's guidance for native apps is *"don't fake borders or bevels; the system
adds highlights for you"*. On the web nothing does, so the specular edge is drawn
here — but kept to a thin bright rim that fades underneath, rather than a bevel.

The important constraint is that **the blur is an enhancement, never what keeps
text readable**. iOS's *Reduce Transparency* setting switches it off, and some
engines parse `backdrop-filter` without compositing it. Both paths fall back to
fully solid surfaces rather than leaving see-through panels with text showing
through the labels — so if the chrome looks solid on a device, check that
setting first.

## Legibility

The app is built for someone tracking daily spending, not for a chart reader,
so the interface leans plain:

- Axis labels are words and numbers on two short lines — `Mon` over `11`,
  `Aug` rather than a bare `A`. Six or seven wide bars, never twelve slivers.
- Changes are written out — "▲ ₹1,100 more compared with last month" — instead
  of leaving the reader to subtract. That comparison is made **once**, on the
  headline. A per-category version of it used to sit below the chart as a
  dumbbell plot, and it was removed: on a month it was informative, but the
  screen opens on a single day, where "Food & Drink, down ₹50" reads as a
  finding when all it means is that yesterday happened to include a tea and
  today did not. A category's **share of the period** says something true at
  every zoom level, so that is what is shown instead.
- The real entries are on screen, not just the totals derived from them. A
  figure you cannot check is a figure you have to trust.
- A period with nothing in it says "Nothing spent" rather than showing ₹0.00 as
  though it were a measurement.
- The add button is centred and oversized: it is the one action the app exists
  for, and the middle of the bottom edge is the easiest place to hit.
- The layout is capped at phone width, so on a tablet or desktop it stays a
  phone-shaped app instead of stretching the chart into a huge empty box.

## Notes on the code

- `storage.js` — all persistence. Money is stored as an **integer count of
  paise/cents**, never a float, so long lists of expenses cannot drift by a
  rounding error. Every read normalises records, so a malformed or legacy entry
  can never reach the arithmetic as a string.
- `app.js` — rendering and interaction. Calendar dates are read from local
  fields and stepped in UTC, which avoids the off-by-one-day bug that hits any
  timezone ahead of UTC.
- **Every bar carries its figure**, not only the selected one — a chart you have
  to tap through a column at a time cannot be compared, which is the only reason
  to put seven of them side by side. The selected bar's is bolder and at full
  contrast; the rest are muted.
- **A bar's figure sits above that bar**, not in a band at the top of the card.
  Pinned to the top, a ₹670 day and a ₹5,000 day printed their numbers in exactly
  the same place, which said the two were somehow equivalent. Long figures step
  down a size rather than run into their neighbours — Indian grouping makes a
  lakh eight characters wide in a 41-unit column.
- **The bars share the calendar's palette.** They take its two strongest steps —
  the deepest for the selected bar, the one below it for the rest — and reference
  those tokens directly, so the two views cannot drift apart the first time
  either is tuned. Before this the unselected bars were grey while the same days
  were tinted indigo in the calendar: one dataset, two colour languages.

  The chart does **not** take the calendar's full four-step ramp, though. A
  bar's *height* already says how much, so tinting by amount as well would
  encode it twice and leave nothing for the selection to say. In the calendar
  colour has to do that work, because every cell is the same size. So: colour
  means *amount* in the calendar and *emphasis* in the chart, which is why they
  share a palette rather than a scale.

  Direction of change is always carried by an arrow **and** a word, so nothing
  ever depends on colour alone.
- `sw.js` — caches the app shell for offline use. **Bump `CACHE` whenever an
  app file changes**, otherwise installed copies keep serving the old version.
- `icons/` — generated, not hand-drawn; see the icon script in the project
  history if they need regenerating.

## Updates

The app serves itself from its own cache, which is what makes it open instantly
and work offline — and also what can leave a published fix unseen. Two things
keep that honest:

- The shell is cached with `cache: 'reload'`, bypassing the browser's own HTTP
  cache. GitHub Pages serves these files with a ten-minute `max-age`, so a plain
  `addAll` could refill a brand new cache with the same stale copies it was
  created to replace.
- When a new worker takes over, the page **reloads itself**, so an update lands
  on the open you are in rather than the next one. It checks on launch and every
  time the app comes back to the foreground.

**Settings → About shows the version number**, and there is a *Check for update*
button beside it. Without a visible version there is no way to tell a fixed build
from a cached one, and "it still doesn't work" cannot be answered. Bump
`APP_VERSION` in `app.js` and `CACHE` in `sw.js` together on every release.

## The calendar

At day zoom the chart has a twin: a month grid — the shape everyone already
reads dates in, and one that makes the shape of a month visible: weekends, the
gap after payday, the run of quiet days.

It is an **alternative, not a replacement**. The two answer different questions —
the chart shows the run of the last seven days and how they compare, the calendar
shows a whole month at once — so a small switch beside the heading picks between
them and the choice is stored. It only appears at day zoom, since week, month and
year have no calendar to show.

Shading is **four flat steps, not a gradient**. A smooth ramp asks the reader to
rank shades against each other; four levels can be told apart at a glance. Any
day with spending is at least step 1, so a small day never disappears into the
empty ones, and the scale is written underneath in words — the wording flips
between "darker" and "brighter" with the theme, because the ramp runs towards
deep indigo on a light page and pale indigo on a dark one.

Today is its date **in the accent colour**; the selection is a **ring** around
the cell. On the chart, the selection is the coloured bar and today is a **dot
under its label**. Two different marks in both, because "where I am" and "what I
am looking at" are different questions — with a single shared mark, today
vanished the moment you picked any other day.
Days that have not happened are greyed and cannot be selected — a day with no
spending yet is not a day with nothing spent.

Each cell carries the **day's total as well as its shade** — the shading is what
makes a heavy week visible without reading thirty numbers, the figure is what
lets you check one.

**A category focus scopes the grid as well.** Focus Food and every cell reports
what Food cost that day, the shading rescales to the biggest Food day, and days
with no Food in them fall to 0. The cells used to keep reporting whole-day totals
while the headline, the breakdown and the entries had all narrowed — the same
grid answering a different question from everything around it, under a heading
that said otherwise.

The date and the amount are deliberately unalike — the date heavier and tighter,
the amount lighter and a shade quieter. They used to share a size, a weight and a
colour, which left two numbers in one 44px cell with nothing saying which was
which.

**Every day that has happened carries a figure, zeros included.** A column of
numbers with holes in it is harder to scan than one without, and a 0 is a real
answer to "what did I spend" rather than a missing one — it just recedes, since
it is not news. A day that has *not* happened stays blank: a 0 there would be a
claim about a day that is not over. It is a plain grouped number, deliberately not `Intl`'s
compact notation: in `en-IN` that abbreviates a thousand as **T**, so ₹4,500
renders as "4.5T", which reads as trillions to anyone who has not met the
convention.

Swiping moves a whole month and keeps the day of the month, so the figures below
stay about a comparable day rather than jumping to the 1st. The header arrows
still step a single day, so both scales are reachable.

The grid is `repeat(7, minmax(0, 1fr))`, not `repeat(7, 1fr)`. A bare `1fr`
floors each track at its content's minimum, and the empty leading cells'
`aspect-ratio` fed the row height back in as a width — the first five columns
came out at 53.8px against the rest at 43.4px, the grid overflowed its card, and
the whole month sat a column out of true.

## Settings, folded

Settings opens on two things: the theme and the currency — the two anyone might
reasonably change — and below them a single row, **Data & Sync**, that holds the
Google Sheet, the Shortcut and the backup controls.

Those three are setup, not settings: you touch them once when the app is new and
then never again. Left open they were the *majority* of the screen — a URL field,
a token field, two long generated links and a pair of destructive buttons — so
the two live controls sat at the top of a wall of one-time plumbing, and *Erase
everything* was one stray tap away at all times. Folded, they are still one tap
from view for the day they are needed.

The summary is set like a **section heading**, not like a row: it is the parent
of everything the fold contains, and at 16px/600 it was smaller and lighter than
the 21px/700 headings *inside* it — the loudest type on the screen sitting inside
the quietest control, which made it read as a caption for the section below
rather than the thing that opened it. Its own sub-headings step down to 16.5px in
turn, and indent to the summary's left edge, so no child starts further left than
its parent. Title and note **stack** instead of sharing a line, because side by
side a 21px title and a three-word note both wrapped and turned one row into four
ragged lines. The chevron holds the right edge whether the fold is open or shut —
it used to snap back against the title on opening, because the margin pushing it
right lived on the note that had just been hidden. Open, the summary gets a
hairline floor; without one the first heading sat 4px below the label with
nothing between them.

**About stays outside the fold**, since the version number is what you go to
Settings to read when something looks wrong, and burying the thing you check
during a problem inside a collapsed section is exactly backwards.

About itself is the one card here that is *read* rather than operated, so it is
written in sentences instead of rows: a line at title size, then three claims
whose openers carry the weight, so the whole card can be taken in three glances.
It opens by saying plainly what the app is and what you do with it, then the
three things that are actually unusual about it — the data is private on the
device, sync goes to a **Google Sheet in your own account** rather than anyone's
server, and a small API means a Shortcut or Siri can log a spend without opening
the app at all. Then the version, the update button, and one quiet closing line
carrying the name and the notice together, both at caption size: neither is
something anyone came to Settings to read, so neither gets to be the biggest
thing on the card.

Version 23 shipped **more than once**: the calendar and the fold, then this copy. The rule is normally that `APP_VERSION` and `sw.js`'s `CACHE` move
together, but where a release only rewrites visible words, the words are their own
proof of arrival — so the version held and `CACHE` took a suffix instead.

### There is no title bar

It went through two rounds of being made subtler — first losing its shadow and
its four-sided rim, then taking a fill closer to the page — before the right
answer turned out to be that it should not be there at all.

The reasoning that kept it was that a screen needs to say which screen it is once
its large title has scrolled away. But the **tab bar already answers that**, all
the time, without a second piece of chrome doing it again. A strip pinned across
the top with a fill and an edge is a shape from a decade ago, and no amount of
softening changes what shape it is.

So the title now lives in the content and scrolls away with it, and nothing
replaces it. **The date arrows on Today moved into the title row** rather than
disappearing with the bar: they act on the day being shown, so they belong beside
its name, and they scroll away with it too.

What is left at the top of a screen is the title, the controls that belong to it,
and the page.

One thing had to be added back. With no bar, content scrolling up would run
straight into the clock and the battery, so each screen carries a **fade** over
the safe area — page colour at the very top, transparent by the time it clears
the notch. It is the same colour as the page in both themes, so it is invisible
until something scrolls under it. A hard cut there would have looked like a bar
again.

The checks describe the **absence**: no `.app-header` in the markup or the
stylesheet, nothing painting a wide strip at the top of any screen in either
theme, the fade never intercepting a tap, every title scrolling away rather than
sticking — and the date arrows still a real tap target that still changes the day.
A bar cannot come back quietly once its absence is what is asserted.

## The strip above the page

On a home-screen iPhone app, the band behind the clock and the battery is painted
from `<meta name="theme-color">`. Getting it wrong is very visible in light mode
and invisible in dark, because a wrong value is usually near-black and dark mode
is black anyway.

Two things were wrong. The tag shipped as a fixed indigo and was corrected to the
theme by `applyTheme()` **after** the document had loaded — but iOS reads the tag
while parsing, so in standalone mode a later `setAttribute` is not reliably
honoured, and the launch value is the one that sticks. And the values it set,
`#eef0f6` / `#0b0b13`, were not `--bg`; even when they did apply, the strip was a
near-miss of the page rather than the page.

So the document now carries a **media pair** — the light colour under
`(prefers-color-scheme: light)`, the dark one under dark — correct at parse time
with no script involved, which is the right answer for anyone on *match my
phone*. An explicit **Light** or **Dark** overrules the phone, so the pre-paint
script in `index.html` pins both tags to the chosen colour there and then, before
iOS has read either. `applyTheme()` still writes them so a live toggle is honest,
and it writes **both states out in full** rather than toggling, since switching
back and forth otherwise leaves one tag holding the other's media query.

All four values — the two tags, `--bg` in both themes, and the manifest's
`theme_color` — are asserted equal by the status-bar suite, because the failure
mode here is a near-miss, and a near-miss is not something you can see by eye.

## Coming from another app

**Settings → Data & Sync → Bring data from another app** reads a CSV export from
whatever someone was using before. It is the difference between trying Tracky and
moving to it: an expense tracker with no history in it cannot answer the only
question anyone asks of one.

Three rules shape that screen.

**Nothing is written until the last button.** Someone moving five years of
spending across cannot undo a bad import, so every guess the parser makes is on
screen — which column is which, how their categories map to these ones, how many
rows, what span, what total — and every one is correctable before anything is
saved. It **adds**; it does not replace, unlike restoring a Tracky backup. The
expenses someone typed in while trying the app are the last thing an import
should destroy.

**It asks only what it cannot work out.** The date order, which sign means money
spent, which column is which — each question appears only when the file is
genuinely ambiguous about it. A wizard that asks five questions to import an
obvious file teaches people to click through without reading, which is exactly
the habit that makes the one question that *mattered* get missed.

**It never silently drops a row.** Unreadable rows are counted, and can be listed
with their line numbers.

### What the parser has to survive

Files nobody here has seen, which is why `csv.js` is separate, pure, and tested
against the shapes real exports take rather than only against files we wrote.

- **A comma inside a note.** `split(',')` shifts every column after it, and the
  result looks like data rather than an error. Hence a real quote-aware scanner.
- **Semicolons and tabs.** A machine set to a comma-decimal locale exports with
  semicolons, and such a file read as comma-separated parses as one column —
  which surfaces as "no date column found" rather than as the delimiter problem
  it is. The delimiter is sniffed, counting only outside quotes so a note full of
  commas cannot win the vote.
- **`1,234.56` and `1.234,56`.** The same amount under two conventions, and
  reading it wrong is off by a factor of a hundred rather than visibly broken.
  The rule: the last separator is the decimal point when 1–2 digits follow it,
  and a thousands mark otherwise. That reads both, and `1,23,456.78` too.
- **`08/09/2026`.** Genuinely ambiguous, and no cleverness fixes it — so any
  value over 12 in either slot settles the file, and only a file where *every*
  row is ambiguous asks. ISO and written months are never asked about.
- **31 September.** Refused, rather than let `Date` roll it into October.
- **Both signs in one file.** Usually means income is in there too. Only the
  person who exported it knows which sign is which, so it asks — once.

### Categories that do not match

A category the file uses and this app does not is **not an error**, and it is not
quietly swept into Other either — either of those would lose information the
person is trying to bring across.

Matching goes: the same name, then a table of the obvious synonyms ("Eating out"
→ Food, "Petrol" → Transport), and whatever is left is offered as **Create
"Pet supplies"**, already selected. Importing creates it as a real category —
listed in Settings, pickable when adding an expense by hand, given a colour from
the palette like any other, and an icon guessed from a word in its name so it
does not sit in that list forever marked as the one that came from a machine.

Every one of those is a dropdown, so anything can be pointed at an existing
category instead, and a category redirected that way is never created. Two
spellings of the same name are offered once and land in one category.

One thing this does not do: **categories are not synced**. The sheet carries
expenses, not the category list, so a category created by an import on one phone
does not appear on another. An expense referencing an id the second device has
never heard of is shown under an orphan category rather than dropped, so nothing
is lost — but the name and icon have to be set again there.

## What a tester pass turned up

Five defects, all shipped, all found by asking what a person eventually produces
by accident rather than whether the happy path works. Each is pinned by a check
in the robustness suite.

**A double tap on Save booked the expense twice.** `closeSheet()` cleared the id
being edited but left the typed amount standing, so a second tap passed the same
amount through again — and a phone delivers a second tap readily, since the frame
where the sheet is closing still has the button under the finger. Two identical
expenses, and nothing on screen afterwards saying which was the mistake. The
sheet now clears the amount, the note and the Save button on close.

**`Infinity` was accepted and stored as nothing.** `Math.max(0, Infinity)` is
`Infinity`, `JSON.stringify` writes that as `null`, and the row came back after a
reload with no amount at all. Amounts are now coerced to a finite integer and
clamped.

**A junk date was stored verbatim.** An expense dated `"nonsense"` belongs to no
day, month or year: it sits in the file, is counted by nothing, and appears on no
screen — money that vanished without being deleted. Dates must now parse as real
calendar days, which also refuses 30 February and 31 April rather than letting
`Date` roll them into the next month.

**One bad row killed a whole sync.** `normalizeExpense(null)` threw, so a single
malformed row from the sheet took down the entire merge with a `TypeError` and
sync stayed broken until someone found the row by hand. An unusable record now
costs that record and nothing else.

**A note could outgrow the sheet.** `server/Code.gs` stores 200 characters; the
app stored any length, so a long description from a CSV was one length here and
another there — a difference no screen shows and nothing reconciles.

The three that reach storage are fixed **in `normalizeExpense`**, not at the
keypad. Every expense in the app comes through there — typed in, restored from a
backup, read out of a CSV, merged down from the sheet — and a guard on the keypad
protects exactly one of those four doors.

Also fixed in the same pass: `.btn-primary` was white on the accent, which is
6.29:1 in light and **2.63:1 in dark**, where the accent lifts to a pale
`#8f96ff` so it can be seen against black. An `--on-primary` token now carries
near-black there.

What held up: date arithmetic across month and year boundaries, leap years,
three timezones either side of the date line, recovery from six kinds of damaged
`localStorage`, budget maths at zero, at exactly on budget, over budget and on the
last day of a 31-day month, delete-then-undo, and fast tab switching.

## The icon

`tools/make-icons.js` generates all three files from one definition, because they
are the same artwork at different sizes and safe areas and hand-editing three
PNGs is how a maskable icon ends up cropped differently from the one beside it.

    node tools/make-icons.js          # OLED black
    node tools/make-icons.js indigo   # the original purple

All three are **full-bleed squares with square corners**. iOS masks a home-screen
icon into its own squircle and Android into whatever shape the launcher uses, so
rounding the corners here would round an already-rounded shape and leave
transparent notches at the edges of the result.

The maskable one draws the mark smaller, because its crop is unknown and can be
a full circle: everything inked has to sit inside the middle 80%. The suite
measures the actual ink bounding box against that circle rather than trusting the
margin to be right.

**The mark is geometry, not a font glyph.** The first attempt at the recolour set
a `T` in the system font, which lost the rounded stem and — more to the point —
the **dot beneath it**. Those two are what make it a mark rather than a letter.
It is now rebuilt from proportions measured off the original artwork, and the
suite asserts the structure: two separate shapes, the lower one round, centred
under the stem, with the stem-to-bar ratio of the original. Nothing about "is it
512 square" or "is it black" noticed the dot going missing.

Measuring it is worth doing properly. A span read near the end of a rounded shape
comes back narrower than the shape is, which is how the rebuild first came out
with a stem three-quarters of its real width; widths are taken at mid-height. The
finished file was checked against the original by comparing inked pixels with
colour ignored — 1.2% of the mark differs, which is the antialiasing.

The generator had a bug of its own, too: `letter-spacing` is applied after the
last character as well as between characters, so centring a one-letter line with
it left the glyph 5px off-centre at 512 — invisible until a launcher crop takes
an uneven bite.

### Getting a changed icon onto a phone

Two separate caches stand in the way, and clearing only one of them looks like
the change did not work.

**iOS reads the icon URL once**, when the app is added to the home screen, and
then never again. There is no refresh: the app has to be **removed from the home
screen and re-added**. Nothing the page does at runtime can change the icon of an
app already installed.

**And re-adding only helps if Safari does not serve the old PNG from its own HTTP
cache.** GitHub Pages sends a `max-age`, so it will. Every reference therefore
carries a `?v=` — in `index.html`, in `manifest.webmanifest`, and in `sw.js`'s
`SHELL`, which caches by exact URL and would otherwise store the icon under a URL
the page never asks for. Bump that string whenever the artwork changes; a check
asserts all three agree, since a mismatch is invisible until someone re-adds the
app and gets the previous icon back.

## Backing up

Your data lives only on the device. Before switching phones, clearing browser
data, or reinstalling, go to **Settings → Download backup** and keep the JSON
file somewhere safe. **Settings → Restore backup** reads it back.

Renaming the repository moves the site's address but **not** your data. Browser
storage is keyed to the origin — `dakshp.github.io` — and ignores the path, so
`/Tapyclone/` and `/Tracky/` read and write the same store and everything logged
before the rename is already there. What does not carry across is the installed
icon: it points at the old address, so add the new one to the Home Screen and
delete the old one.
